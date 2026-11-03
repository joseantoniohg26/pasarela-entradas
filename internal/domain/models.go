package domain

import (
	"errors"
	"time"
)

var (
	ErrLimiteAlcanzado     = errors.New("máximo de entradas por cliente alcanzado")
	ErrAsientoNoDisponible = errors.New("ese asiento ya no está disponible")
	ErrConflictoReserva    = errors.New("conflicto en la reserva o pago")
	ErrPagoRechazado       = errors.New("el pago fue rechazado por la entidad bancaria")
	ErrNoEncontrado        = errors.New("recurso no encontrado")
)

type Evento struct {
	ID        int       `json:"id"`
	Nombre    string    `json:"nombre"`
	Lugar     string    `json:"lugar"`
	Fecha     time.Time `json:"fecha"`
	AficheURL *string   `json:"afiche_url"`
}

type Asiento struct {
	ID             int        `json:"id"`
	Fila           string     `json:"fila"`
	Numero         int        `json:"numero"`
	Precio         float64    `json:"precio"`
	Zona           string     `json:"zona"`
	Estado         string     `json:"estado"`
	EsMio          bool       `json:"es_mio"`
	ReservadoHasta *time.Time `json:"reservado_hasta"`
}

type Orden struct {
	Codigo          string    `json:"codigo"`
	AsientoID       int       `json:"asiento_id"`
	Comprador       string    `json:"comprador"`
	Email           string    `json:"email"`
	Monto           float64   `json:"monto"`
	TarjetaUltimos4 string    `json:"tarjeta_ultimos4"`
	CreadoEn        time.Time `json:"creado_en"`
	UsadoEn         *time.Time `json:"usado_en,omitempty"`
}

type DetalleEntrada struct {
	Codigo          string    `json:"codigo"`
	Comprador       string    `json:"comprador"`
	Email           string    `json:"email"`
	Monto           float64   `json:"monto"`
	TarjetaUltimos4 string    `json:"tarjeta_ultimos4"`
	CompradoEn      time.Time `json:"comprado_en"`
	UsadoEn         *time.Time `json:"usado_en"`
	Asiento         string    `json:"asiento"`
	Zona            string    `json:"zona"`
	Evento          string    `json:"evento"`
	Lugar           string    `json:"lugar"`
	Fecha           time.Time `json:"fecha"`
	QRSVG           string    `json:"qr_svg"`
}

type ResumenReporte struct {
	EntradasVendidas  int64             `json:"entradas_vendidas"`
	Ingresos          float64           `json:"ingresos"`
	EntradasUsadas    int64             `json:"entradas_usadas"`
	AforoTotal        int64             `json:"aforo_total"`
	AsientosVendidos  int64             `json:"asientos_vendidos"`
	AsientosReservados int64            `json:"asientos_reservados"`
	Eventos           []EventoReporte   `json:"eventos"`
	UltimasOrdenes    []OrdenReporte    `json:"ultimas_ordenes"`
}

type EventoReporte struct {
	ID         int       `json:"id"`
	Nombre     string    `json:"nombre"`
	Fecha      time.Time `json:"fecha"`
	Aforo      int64     `json:"aforo"`
	Vendidos   int64     `json:"vendidos"`
	Reservados int64     `json:"reservados"`
	Ingresos   float64   `json:"ingresos"`
	Ocupacion  float64   `json:"ocupacion"`
}

type OrdenReporte struct {
	Codigo    string    `json:"codigo"`
	Evento    string    `json:"evento"`
	Asiento   string    `json:"asiento"`
	Comprador string    `json:"comprador"`
	Monto     float64   `json:"monto"`
	CreadoEn  time.Time `json:"creado_en"`
	UsadoEn   *time.Time `json:"usado_en"`
}

