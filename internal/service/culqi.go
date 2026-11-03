package service

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// CulqiService implementa la interfaz PasarelaPago integrando la API v2 oficial de Culqi.
// Alineado con los lineamientos de la norma ISO 25010:
// - Seguridad (Confidencialidad / Integridad / PCI-DSS): El servidor no procesa PAN ni CVV,
//   solo recibe tokens 'tkn_test_...' autorizados por el cliente.
// - Fiabilidad (Tolerancia a fallos): Manejo riguroso de códigos de error bancarios y de red.
// - Eficiencia de Desempeño: Cliente HTTP con timeout estricto (10s) para evitar contención de goroutines.
type CulqiService struct {
	llaveSecreta string
	clienteHTTP  *http.Client
	baseURL      string
}

func NuevoCulqiService(llaveSecreta string) *CulqiService {
	return &CulqiService{
		llaveSecreta: llaveSecreta,
		clienteHTTP: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL: "https://api.culqi.com/v2",
	}
}

type culqiCargoPayload struct {
	Amount       int    `json:"amount"`
	CurrencyCode string `json:"currency_code"`
	Email        string `json:"email"`
	SourceID     string `json:"source_id"`
	Description  string `json:"description"`
}

type culqiCargoRespuesta struct {
	Object  string `json:"object"`
	ID      string `json:"id"`
	Amount  int    `json:"amount"`
	Outcome struct {
		Type            string `json:"type"`
		Code            string `json:"code"`
		MerchantMessage string `json:"merchant_message"`
		UserMessage     string `json:"user_message"`
	} `json:"outcome"`
	Source struct {
		LastFour string `json:"last_four"`
		IIN      struct {
			CardBrand string `json:"card_brand"`
		} `json:"iin"`
	} `json:"source"`
	MerchantMessage string `json:"merchant_message,omitempty"`
	UserMessage     string `json:"user_message,omitempty"`
}

func (c *CulqiService) Cobrar(ctx context.Context, token string, monto float64, descripcion, email string) (map[string]any, error) {
	// Culqi requiere el monto expresado en céntimos enteros (ej. S/ 150.00 -> 15000)
	centimos := int(monto * 100)
	if centimos <= 0 {
		centimos = 1000 // Importe mínimo por defecto
	}

	payload := culqiCargoPayload{
		Amount:       centimos,
		CurrencyCode: "PEN",
		Email:        email,
		SourceID:     token,
		Description:  descripcion,
	}

	cuerpoJSON, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("error al serializar cobro Culqi: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/charges", bytes.NewBuffer(cuerpoJSON))
	if err != nil {
		return nil, fmt.Errorf("error al estructurar petición HTTP Culqi: %w", err)
	}

	req.Header.Set("Authorization", "Bearer "+c.llaveSecreta)
	req.Header.Set("Content-Type", "application/json")

	log.Printf("[CULQI DEBUG] POST %s/charges payload: %s", c.baseURL, string(cuerpoJSON))
	resp, err := c.clienteHTTP.Do(req)
	if err != nil {
		log.Printf("[CULQI DEBUG] HTTP err: %v", err)
		return nil, fmt.Errorf("fallo de comunicación con pasarela Culqi: %w", err)
	}
	defer resp.Body.Close()

	respBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("error al leer respuesta de Culqi: %w", err)
	}
	log.Printf("[CULQI DEBUG] Status: %d, Body: %s", resp.StatusCode, string(respBytes))

	var data culqiCargoRespuesta
	if err := json.Unmarshal(respBytes, &data); err != nil {
		return nil, fmt.Errorf("respuesta inválida de pasarela Culqi: %w", err)
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || data.Object == "error" {
		msg := data.UserMessage
		if msg == "" {
			msg = data.MerchantMessage
		}
		if msg == "" {
			msg = "La transacción fue rechazada por la pasarela de pagos"
		}
		return nil, errors.New(msg)
	}

	ultimos4 := data.Source.LastFour
	if ultimos4 == "" {
		ultimos4 = "••••"
	}
	marca := data.Source.IIN.CardBrand
	if marca == "" {
		marca = "Tarjeta"
	}

	return map[string]any{
		"id":               data.ID,
		"estado":           "aprobado",
		"monto":            monto,
		"marca":            marca,
		"tarjeta_ultimos4": ultimos4,
		"titular":          email,
	}, nil
}
