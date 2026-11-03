package service

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	qrcode "github.com/skip2/go-qrcode"
)

type TokenTarjeta struct {
	Numero        string
	Vencimiento   string
	Titular       string
	Marca         string
	Ultimos4      string
	CreadoEn      time.Time
	TarjetaPrueba bool
}

type PasarelaSimulada struct {
	mu             sync.Mutex
	tokens         map[string]TokenTarjeta
	cargos         map[string]map[string]any
	latenciaMs     int
	culqiSecretKey string
	httpClient     *http.Client
}

func NuevaPasarela(latenciaMs int, culqiSecretKey string) *PasarelaSimulada {
	return &PasarelaSimulada{
		tokens:         make(map[string]TokenTarjeta),
		cargos:         make(map[string]map[string]any),
		latenciaMs:     latenciaMs,
		culqiSecretKey: culqiSecretKey,
		httpClient:     &http.Client{Timeout: 10 * time.Second},
	}
}

func (p *PasarelaSimulada) LuhnValido(numero string) bool {
	var total int
	longitud := len(numero)
	for i := longitud - 1; i >= 0; i-- {
		d := int(numero[i] - '0')
		if (longitud-1-i)%2 == 1 {
			d *= 2
			if d > 9 {
				d -= 9
			}
		}
		total += d
	}
	return total%10 == 0
}

func (p *PasarelaSimulada) DetectarMarca(numero string) string {
	if strings.HasPrefix(numero, "4") {
		return "Visa"
	}
	if len(numero) >= 2 {
		pref := numero[:2]
		if pref >= "51" && pref <= "55" {
			return "Mastercard"
		}
		if pref == "34" || pref == "37" {
			return "American Express"
		}
	}
	return "Otra"
}

func (p *PasarelaSimulada) EstaVencida(vencimiento string) bool {
	partes := strings.Split(vencimiento, "/")
	if len(partes) != 2 {
		return true
	}
	mes, err1 := strconv.Atoi(partes[0])
	anio, err2 := strconv.Atoi(partes[1])
	if err1 != nil || err2 != nil || mes < 1 || mes > 12 {
		return true
	}
	hoy := time.Now()
	anioCompleto := 2000 + anio
	if anioCompleto < hoy.Year() || (anioCompleto == hoy.Year() && time.Month(mes) < hoy.Month()) {
		return true
	}
	return false
}

func (p *PasarelaSimulada) Tokenizar(numero, vencimiento, cvv, titular string) (map[string]string, error) {
	numLimpio := ""
	for _, c := range numero {
		if c >= '0' && c <= '9' {
			numLimpio += string(c)
		}
	}

	if len(numLimpio) < 13 || len(numLimpio) > 19 || !p.LuhnValido(numLimpio) {
		return nil, errors.New("número de tarjeta inválido")
	}
	if p.EstaVencida(vencimiento) {
		return nil, errors.New("la tarjeta está vencida o la fecha es incorrecta")
	}

	b := make([]byte, 12)
	_, _ = rand.Read(b)
	token := "tok_" + hex.EncodeToString(b)
	ultimos4 := numLimpio[len(numLimpio)-4:]
	marca := p.DetectarMarca(numLimpio)

	p.mu.Lock()
	p.tokens[token] = TokenTarjeta{
		Numero:        numLimpio,
		Vencimiento:   vencimiento,
		Titular:       titular,
		Marca:         marca,
		Ultimos4:      ultimos4,
		CreadoEn:      time.Now(),
		TarjetaPrueba: numLimpio == "4000000000000002",
	}
	p.mu.Unlock()

	return map[string]string{
		"token":            token,
		"marca":            marca,
		"tarjeta_ultimos4": ultimos4,
		"titular":          titular,
	}, nil
}

func (p *PasarelaSimulada) Cobrar(token string, monto float64, descripcion, email string) (map[string]any, error) {
	// Si el token proviene de la API de Culqi (ej. tkn_live_ o tkn_test_) y tenemos Secret Key configurada
	if strings.HasPrefix(token, "tkn_") && p.culqiSecretKey != "" {
		return p.cobrarCulqiAPI(token, monto, descripcion, email)
	}

	if p.latenciaMs > 0 {
		time.Sleep(time.Duration(p.latenciaMs) * time.Millisecond)
	}

	p.mu.Lock()
	info, existe := p.tokens[token]
	p.mu.Unlock()

	if !existe {
		return nil, errors.New("el token de pago no existe o ya expiró")
	}

	if info.TarjetaPrueba {
		return nil, errors.New("transacción rechazada por el banco emisor (fondos insuficientes o bloqueo)")
	}

	b := make([]byte, 10)
	_, _ = rand.Read(b)
	cargoID := "ch_" + hex.EncodeToString(b)

	res := map[string]any{
		"id":               cargoID,
		"estado":           "aprobado",
		"monto":            monto,
		"marca":            info.Marca,
		"tarjeta_ultimos4": info.Ultimos4,
		"titular":          info.Titular,
	}

	p.mu.Lock()
	p.cargos[cargoID] = res
	p.mu.Unlock()

	return res, nil
}

func (p *PasarelaSimulada) cobrarCulqiAPI(token string, monto float64, descripcion, email string) (map[string]any, error) {
	// Culqi requiere el monto expresado en céntimos
	centimos := int64(monto * 100)
	if descripcion == "" {
		descripcion = "Entrada Paulo Londra - Estadio Nacional 2026"
	}

	payload := map[string]any{
		"amount":        centimos,
		"currency_code": "PEN",
		"email":         email,
		"source_id":     token,
		"description":   descripcion,
		"capture":       true,
	}

	cuerpoJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("error al serializar cargo Culqi: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, "https://api.culqi.com/v2/charges", bytes.NewBuffer(cuerpoJSON))
	if err != nil {
		return nil, fmt.Errorf("error creando petición a Culqi: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.culqiSecretKey)

	resp, err := p.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("error de conexión con Culqi: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error leyendo respuesta de Culqi: %w", err)
	}

	var culqiResp map[string]any
	if err := json.Unmarshal(respBytes, &culqiResp); err != nil {
		return nil, fmt.Errorf("respuesta inválida de Culqi: %s", string(respBytes))
	}

	if resp.StatusCode >= 400 {
		userMsg, _ := culqiResp["user_message"].(string)
		merchantMsg, _ := culqiResp["merchant_message"].(string)
		if userMsg != "" {
			return nil, errors.New(userMsg)
		}
		if merchantMsg != "" {
			return nil, errors.New(merchantMsg)
		}
		return nil, fmt.Errorf("cargo rechazado por Culqi (status %d)", resp.StatusCode)
	}

	cargoID, _ := culqiResp["id"].(string)
	ultimos4 := "----"
	marca := "Culqi"

	if srcObj, ok := culqiResp["source"].(map[string]any); ok {
		if iin, ok := srcObj["iin"].(map[string]any); ok {
			if m, ok := iin["card_brand"].(string); ok && m != "" {
				marca = m
			}
		}
		if last4, ok := srcObj["last_four"].(string); ok && last4 != "" {
			ultimos4 = last4
		}
	}

	res := map[string]any{
		"id":               cargoID,
		"estado":           "aprobado",
		"monto":            monto,
		"marca":            marca,
		"tarjeta_ultimos4": ultimos4,
		"titular":          email,
	}

	p.mu.Lock()
	p.cargos[cargoID] = res
	p.mu.Unlock()

	return res, nil
}

// --- Antibots: Limitador por IP (Ventana Deslizante) ---

type LimitadorPeticiones struct {
	maximo         int
	ventana        time.Duration
	mu             sync.Mutex
	historial      map[string][]time.Time
	ultimaLimpieza time.Time
}

func NuevoLimitador(maximo, ventanaSeg int) *LimitadorPeticiones {
	return &LimitadorPeticiones{
		maximo:         maximo,
		ventana:        time.Duration(ventanaSeg) * time.Second,
		historial:      make(map[string][]time.Time),
		ultimaLimpieza: time.Now(),
	}
}

func (l *LimitadorPeticiones) Permitir(ip string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()

	ahora := time.Now()
	marcas := l.historial[ip]

	idx := 0
	for idx < len(marcas) && ahora.Sub(marcas[idx]) > l.ventana {
		idx++
	}
	marcas = marcas[idx:]

	if len(marcas) >= l.maximo {
		espera := l.ventana - ahora.Sub(marcas[0])
		l.historial[ip] = marcas
		sec := int(espera.Seconds())
		if sec < 1 {
			sec = 1
		}
		return false, sec
	}

	marcas = append(marcas, ahora)
	l.historial[ip] = marcas

	if ahora.Sub(l.ultimaLimpieza) > time.Minute {
		l.ultimaLimpieza = ahora
		for k, v := range l.historial {
			if len(v) == 0 || ahora.Sub(v[len(v)-1]) > l.ventana {
				delete(l.historial, k)
			}
		}
	}

	return true, 0
}

// --- Generador de QR Seguro y Verificación de Puerta ---

type ServicioEntradas struct {
	secreto string
}

func NuevoServicioEntradas(secreto string) *ServicioEntradas {
	return &ServicioEntradas{secreto: secreto}
}

func (e *ServicioEntradas) FirmarCodigo(codigo string) string {
	mac := hmac.New(sha256.New, []byte(e.secreto))
	mac.Write([]byte(codigo))
	return hex.EncodeToString(mac.Sum(nil))[:16]
}

func (e *ServicioEntradas) ContenidoQR(codigo string) string {
	return fmt.Sprintf("TIQUETERA|%s|%s", codigo, e.FirmarCodigo(codigo))
}

func (e *ServicioEntradas) ValidarContenidoQR(contenido string) (string, error) {
	partes := strings.Split(strings.TrimSpace(contenido), "|")
	if len(partes) != 3 || partes[0] != "TIQUETERA" {
		return "", errors.New("formato de QR desconocido")
	}
	codigo := partes[1]
	firma := partes[2]
	esperada := e.FirmarCodigo(codigo)

	if !hmac.Equal([]byte(firma), []byte(esperada)) {
		return "", errors.New("firma inválida o código adulterado")
	}
	return codigo, nil
}

func (e *ServicioEntradas) GenerarSVG(contenido string) (string, error) {
	png, err := qrcode.Encode(contenido, qrcode.Medium, 256)
	if err != nil {
		return "", err
	}
	encoded := base64.StdEncoding.EncodeToString(png)
	return fmt.Sprintf(`<img src="data:image/png;base64,%s" alt="QR" style="width:100%%;height:auto;" />`, encoded), nil
}

// --- Métricas Thread-Safe de Alta Frecuencia ---

type Metricas struct {
	mu         sync.RWMutex
	contadores map[string]int64
	inicio     time.Time
}

func NuevasMetricas() *Metricas {
	return &Metricas{
		contadores: make(map[string]int64),
		inicio:     time.Now(),
	}
}

func (m *Metricas) Sumar(nombre string, cant int64) {
	m.mu.Lock()
	m.contadores[nombre] += cant
	m.mu.Unlock()
}

func (m *Metricas) Resumen() map[string]any {
	m.mu.RLock()
	defer m.mu.RUnlock()

	res := make(map[string]any)
	for k, v := range m.contadores {
		res[k] = v
	}
	res["segundos_activo"] = int(time.Since(m.inicio).Seconds())
	return res
}

func (m *Metricas) Reiniciar() {
	m.mu.Lock()
	m.contadores = make(map[string]int64)
	m.inicio = time.Now()
	m.mu.Unlock()
}

var EmailRegex = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
