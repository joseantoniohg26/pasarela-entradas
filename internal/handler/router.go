package handler

import (
	"crypto/hmac"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"pasarela-entradas/internal/config"
	"pasarela-entradas/internal/domain"
	"pasarela-entradas/internal/repository"
	"pasarela-entradas/internal/service"
)

const (
	ErrMetodoNoPermitido = "Método no permitido"
	ErrCuerpoInvalido    = "Cuerpo inválido"
)

type DependenciasRouter struct {
	Cfg       *config.Config
	Repo      *repository.Repositorio
	Sala      *service.SalaEspera
	Pasarela  service.PasarelaPago
	Simulador *service.PasarelaSimulada
	LimiteIP  *service.LimitadorPeticiones
	Entradas  *service.ServicioEntradas
	Metricas  *service.Metricas
	StaticDir string
}

type RouterHandler struct {
	cfg       *config.Config
	repo      *repository.Repositorio
	sala      *service.SalaEspera
	pasarela  service.PasarelaPago
	simulador *service.PasarelaSimulada
	limiteIP  *service.LimitadorPeticiones
	entradas  *service.ServicioEntradas
	metricas  *service.Metricas
	mux       *http.ServeMux
	fileServe http.Handler
}

func NuevoRouter(deps DependenciasRouter) *RouterHandler {
	h := &RouterHandler{
		cfg:       deps.Cfg,
		repo:      deps.Repo,
		sala:      deps.Sala,
		pasarela:  deps.Pasarela,
		simulador: deps.Simulador,
		limiteIP:  deps.LimiteIP,
		entradas:  deps.Entradas,
		metricas:  deps.Metricas,
		mux:       http.NewServeMux(),
		fileServe: http.FileServer(http.Dir(deps.StaticDir)),
	}
	h.rutas()
	return h
}

func (h *RouterHandler) rutas() {
	// Pasarela simulada
	h.mux.HandleFunc("/simulador-pasarela/tokenizar", h.tokenizar)

	// API Informativa
	h.mux.HandleFunc("/api/config", h.verConfig)
	h.mux.HandleFunc("/api/salud", h.salud)
	h.mux.HandleFunc("/api/metricas/reiniciar", h.reiniciarMetricas)

	// Sala de espera
	h.mux.HandleFunc("/api/sala/entrar", h.salaEntrar)
	h.mux.HandleFunc("/api/sala/", h.salaConsultar)

	// Eventos y asientos
	h.mux.HandleFunc("/api/eventos", h.listarEventos)
	h.mux.HandleFunc("/api/eventos/", h.enrutarEventoSubrecursos)

	// Reservas y compras
	h.mux.HandleFunc("/api/reservas", h.crearReserva)
	h.mux.HandleFunc("/api/reservas/", h.cancelarReserva)
	h.mux.HandleFunc("/api/pagos", h.pagar)

	// Entradas y validación puerta
	h.mux.HandleFunc("/api/entradas/", h.verEntrada)
	h.mux.HandleFunc("/api/admin/resumen", h.adminResumen)
	h.mux.HandleFunc("/api/admin/validar", h.adminValidar)

	// Archivos estáticos frontend (UI existente)
	h.mux.Handle("/", h.fileServe)
}

func (h *RouterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.cfg.Antibots && (strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/simulador-pasarela/")) {
		ip := r.RemoteAddr
		if colon := strings.LastIndex(ip, ":"); colon != -1 {
			ip = ip[:colon]
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			ip = strings.TrimSpace(strings.Split(xff, ",")[0])
		}

		permitido, espera := h.limiteIP.Permitir(ip)
		if !permitido {
			h.metricas.Sumar("bloqueos_antibots", 1)
			w.Header().Set("Retry-After", strconv.Itoa(espera))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusTooManyRequests)
			_ = json.NewEncoder(w).Encode(map[string]string{"detail": "Demasiadas solicitudes. Espera unos segundos."})
			return
		}
	}
	h.mux.ServeHTTP(w, r)
}

func (h *RouterHandler) responderJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if data != nil {
		_ = json.NewEncoder(w).Encode(data)
	}
}

func (h *RouterHandler) responderError(w http.ResponseWriter, status int, mensaje string) {
	h.responderJSON(w, status, map[string]string{"detail": mensaje})
}

func (h *RouterHandler) identificarCliente(r *http.Request) (string, error) {
	if h.cfg.ModoReserva == "sala" {
		pase := r.Header.Get("X-Pase")
		if pase == "" {
			return "", errors.New("Debes pasar por la sala de espera")
		}
		ticket := h.sala.ValidarPase(pase)
		if ticket == "" {
			return "", errors.New("Debes pasar por la sala de espera")
		}
		return ticket, nil
	}
	sesion := r.Header.Get("X-Sesion")
	if sesion == "" || len(sesion) > 64 {
		return "", errors.New("Falta la cabecera X-Sesion")
	}
	return sesion, nil
}

func (h *RouterHandler) verificarAdmin(r *http.Request) bool {
	if h.cfg.AdminClave == "" {
		return false
	}
	clave := r.Header.Get("X-Clave-Admin")
	if clave == "" || !hmac.Equal([]byte(clave), []byte(h.cfg.AdminClave)) {
		h.metricas.Sumar("admin_clave_incorrecta", 1)
		return false
	}
	return true
}

func (h *RouterHandler) tokenizar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	var datos struct {
		Numero      string `json:"numero"`
		Vencimiento string `json:"vencimiento"`
		CVV         string `json:"cvv"`
		Titular     string `json:"titular"`
	}
	if err := json.NewDecoder(r.Body).Decode(&datos); err != nil {
		h.responderError(w, http.StatusUnprocessableEntity, ErrCuerpoInvalido)
		return
	}
	if h.simulador == nil {
		h.responderError(w, http.StatusServiceUnavailable, "Simulador no disponible")
		return
	}
	res, err := h.simulador.Tokenizar(datos.Numero, datos.Vencimiento, datos.CVV, datos.Titular)
	if err != nil {
		h.responderError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	h.responderJSON(w, http.StatusOK, res)
}

func (h *RouterHandler) verConfig(w http.ResponseWriter, r *http.Request) {
	h.responderJSON(w, http.StatusOK, map[string]any{
		"modo":             h.cfg.ModoReserva,
		"reserva_minutos":  h.cfg.ReservaMinutos,
		"max_entradas":     h.cfg.MaxEntradasCliente,
		"proveedor_pago":   h.cfg.ProveedorPago,
		"culqi_public_key": h.cfg.CulqiPublicKey,
	})
}

func (h *RouterHandler) salud(w http.ResponseWriter, r *http.Request) {
	h.responderJSON(w, http.StatusOK, map[string]any{
		"ok":       true,
		"modo":     h.cfg.ModoReserva,
		"antibots": h.cfg.Antibots,
		"sala":     h.sala.Resumen(),
		"metricas": h.metricas.Resumen(),
	})
}

func (h *RouterHandler) reiniciarMetricas(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	h.metricas.Reiniciar()
	h.responderJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *RouterHandler) salaEntrar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	ticket, posicion := h.sala.Entrar()
	h.metricas.Sumar("sala_llegadas", 1)
	h.responderJSON(w, http.StatusOK, map[string]any{"ticket": ticket, "posicion": posicion})
}

func (h *RouterHandler) salaConsultar(w http.ResponseWriter, r *http.Request) {
	ticket := strings.TrimPrefix(r.URL.Path, "/api/sala/")
	if ticket == "" {
		h.responderError(w, http.StatusBadRequest, "Falta ticket")
		return
	}
	estado := h.sala.Consultar(ticket)
	if estado == nil {
		h.responderError(w, http.StatusNotFound, "Ticket desconocido; vuelve a entrar a la sala")
		return
	}
	h.responderJSON(w, http.StatusOK, estado)
}

func (h *RouterHandler) listarEventos(w http.ResponseWriter, r *http.Request) {
	eventos, err := h.repo.ListarEventos(r.Context())
	if err != nil {
		h.responderError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.responderJSON(w, http.StatusOK, eventos)
}

func (h *RouterHandler) enrutarEventoSubrecursos(w http.ResponseWriter, r *http.Request) {
	partes := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(partes) == 3 { // /api/eventos/{id}
		id, err := strconv.Atoi(partes[2])
		if err != nil {
			h.responderError(w, http.StatusBadRequest, "ID de evento inválido")
			return
		}
		ev, err := h.repo.ObtenerEvento(r.Context(), id)
		if err != nil {
			h.responderError(w, http.StatusInternalServerError, err.Error())
			return
		}
		if ev == nil {
			h.responderError(w, http.StatusNotFound, "Ese evento no existe")
			return
		}
		h.responderJSON(w, http.StatusOK, ev)
		return
	} else if len(partes) == 4 && partes[3] == "asientos" { // /api/eventos/{id}/asientos
		id, err := strconv.Atoi(partes[2])
		if err != nil {
			h.responderError(w, http.StatusBadRequest, "ID de evento inválido")
			return
		}
		cliente := ""
		if xPase := r.Header.Get("X-Pase"); xPase != "" {
			cliente = h.sala.ValidarPase(xPase)
		} else {
			cliente = r.Header.Get("X-Sesion")
		}
		asientos, err := h.repo.ListarAsientos(r.Context(), id, cliente)
		if err != nil {
			h.responderError(w, http.StatusInternalServerError, err.Error())
			return
		}
		h.responderJSON(w, http.StatusOK, asientos)
		return
	}
	h.responderError(w, http.StatusNotFound, "Ruta no encontrada")
}

func (h *RouterHandler) crearReserva(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	cliente, err := h.identificarCliente(r)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "sala") {
			status = http.StatusForbidden
		}
		h.responderError(w, status, err.Error())
		return
	}

	var req struct {
		AsientoID int `json:"asiento_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.responderError(w, http.StatusUnprocessableEntity, ErrCuerpoInvalido)
		return
	}

	hasta, err := h.repo.Reservar(r.Context(), req.AsientoID, cliente)
	if errors.Is(err, domain.ErrLimiteAlcanzado) {
		h.metricas.Sumar("reservas_sobre_limite", 1)
		h.responderError(w, http.StatusTooManyRequests, "Máximo de entradas por cliente alcanzado")
		return
	}
	if errors.Is(err, domain.ErrAsientoNoDisponible) || hasta == nil {
		h.metricas.Sumar("reservas_rechazadas", 1)
		h.responderError(w, http.StatusConflict, "Ese asiento ya no está disponible")
		return
	}
	if err != nil {
		h.responderError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.metricas.Sumar("reservas_ok", 1)
	h.responderJSON(w, http.StatusCreated, map[string]any{
		"asiento_id":      req.AsientoID,
		"reservado_hasta": hasta.Format(time.RFC3339),
	})
}

func (h *RouterHandler) cancelarReserva(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	cliente, err := h.identificarCliente(r)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "sala") {
			status = http.StatusForbidden
		}
		h.responderError(w, status, err.Error())
		return
	}

	partes := strings.Split(r.URL.Path, "/")
	asientoID, err := strconv.Atoi(partes[len(partes)-1])
	if err != nil {
		h.responderError(w, http.StatusBadRequest, "ID inválido")
		return
	}

	ok, err := h.repo.Liberar(r.Context(), asientoID, cliente)
	if err != nil || !ok {
		h.responderError(w, http.StatusNotFound, "No tienes una reserva activa en ese asiento")
		return
	}
	h.responderJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *RouterHandler) pagar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	cliente, err := h.identificarCliente(r)
	if err != nil {
		status := http.StatusBadRequest
		if strings.Contains(err.Error(), "sala") {
			status = http.StatusForbidden
		}
		h.responderError(w, status, err.Error())
		return
	}

	var req struct {
		AsientoID int    `json:"asiento_id"`
		Comprador string `json:"comprador"`
		Email     string `json:"email"`
		TokenPago string `json:"token_pago"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.responderError(w, http.StatusUnprocessableEntity, ErrCuerpoInvalido)
		return
	}

	if len(req.Comprador) < 3 || !service.EmailRegex.MatchString(req.Email) {
		h.responderError(w, http.StatusUnprocessableEntity, "Datos de comprador o correo inválidos")
		return
	}

	precio, eventoNombre, err := h.repo.ObtenerInfoReserva(r.Context(), req.AsientoID, cliente)
	if err != nil {
		h.metricas.Sumar("pagos_conflicto", 1)
		h.responderError(w, http.StatusConflict, err.Error())
		return
	}

	descripcion := fmt.Sprintf("%s - Asiento #%d", eventoNombre, req.AsientoID)
	cargo, err := h.pasarela.Cobrar(r.Context(), req.TokenPago, precio, descripcion, req.Email)
	if err != nil {
		h.metricas.Sumar("pagos_rechazados", 1)
		h.responderError(w, http.StatusPaymentRequired, err.Error())
		return
	}

	ultimos4, _ := cargo["tarjeta_ultimos4"].(string)
	cargoID, _ := cargo["id"].(string)

	orden, err := h.repo.PagarYConfirmar(r.Context(), req.AsientoID, cliente, req.Comprador, req.Email, ultimos4, cargoID)
	if err != nil {
		h.metricas.Sumar("pagos_conflicto", 1)
		h.responderError(w, http.StatusConflict, err.Error())
		return
	}

	h.metricas.Sumar("pagos_ok", 1)
	h.responderJSON(w, http.StatusCreated, orden)
}

func (h *RouterHandler) verEntrada(w http.ResponseWriter, r *http.Request) {
	codigo := strings.TrimPrefix(r.URL.Path, "/api/entradas/")
	email := r.URL.Query().Get("email")
	if codigo == "" || email == "" {
		h.responderError(w, http.StatusBadRequest, "Faltan código y correo")
		return
	}

	entrada, err := h.repo.ObtenerEntrada(r.Context(), codigo, email)
	if err != nil || entrada == nil {
		h.metricas.Sumar("entradas_no_encontradas", 1)
		h.responderError(w, http.StatusNotFound, "No hay ninguna entrada con ese código y ese correo")
		return
	}

	qrContenido := h.entradas.ContenidoQR(entrada.Codigo)
	svg, err := h.entradas.GenerarSVG(qrContenido)
	if err == nil {
		entrada.QRSVG = svg
	}

	h.responderJSON(w, http.StatusOK, entrada)
}

func (h *RouterHandler) adminResumen(w http.ResponseWriter, r *http.Request) {
	if !h.verificarAdmin(r) {
		h.responderError(w, http.StatusUnauthorized, "Clave de administrador incorrecta")
		return
	}
	res, err := h.repo.ResumenAdmin(r.Context())
	if err != nil {
		h.responderError(w, http.StatusInternalServerError, err.Error())
		return
	}
	h.responderJSON(w, http.StatusOK, res)
}

func (h *RouterHandler) adminValidar(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		h.responderError(w, http.StatusMethodNotAllowed, ErrMetodoNoPermitido)
		return
	}
	if !h.verificarAdmin(r) {
		h.responderError(w, http.StatusUnauthorized, "Clave de administrador incorrecta")
		return
	}

	var req struct {
		Contenido string `json:"contenido"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.responderError(w, http.StatusUnprocessableEntity, ErrCuerpoInvalido)
		return
	}

	codigo, err := h.entradas.ValidarContenidoQR(req.Contenido)
	if err != nil {
		h.metricas.Sumar("validaciones_falsa", 1)
		h.responderJSON(w, http.StatusOK, map[string]any{"estado": "falsa", "entrada": nil})
		return
	}

	estado, entrada, err := h.repo.MarcarEntradaUsada(r.Context(), codigo)
	if err != nil {
		h.responderError(w, http.StatusInternalServerError, err.Error())
		return
	}

	h.metricas.Sumar("validaciones_"+estado, 1)
	h.responderJSON(w, http.StatusOK, map[string]any{
		"estado":  estado,
		"entrada": entrada,
	})
}

