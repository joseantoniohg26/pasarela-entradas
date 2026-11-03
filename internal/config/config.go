package config

import (
	"crypto/rand"
	"encoding/hex"
	"os"
	"strconv"
	"strings"
)

type Config struct {
	DatabaseURL          string
	ModoReserva          string
	ReservaMinutos       int
	PaseMinutos          int
	MaxEntradasCliente   int
	SalaAdmitidosPorSeg  int
	Antibots             bool
	LimitePeticiones     int
	VentanaSegundos      int
	PoolMax              int
	PoolTimeoutSec       float64
	PagoLatenciaMs       int
	AdminClave           string
	Secreto              string
	Puerto               string
	CulqiPublicKey       string
	CulqiSecretKey       string
	ProveedorPago        string
}

func Cargar() *Config {
	modo := strings.ToLower(strings.TrimSpace(getEnv("MODO_RESERVA", "sala")))
	if modo != "sala" && modo != "directo" && modo != "inseguro" {
		modo = "sala"
	}

	secreto := getEnv("SECRETO", "")
	if secreto == "" {
		bytes := make([]byte, 32)
		_, _ = rand.Read(bytes)
		secreto = hex.EncodeToString(bytes)
	}

	return &Config{
		DatabaseURL:         getEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/pasarela"),
		ModoReserva:         modo,
		ReservaMinutos:      getEnvInt("RESERVA_MINUTOS", 5),
		PaseMinutos:         getEnvInt("PASE_MINUTOS", 15),
		MaxEntradasCliente:  getEnvInt("MAX_ENTRADAS_POR_CLIENTE", 6),
		SalaAdmitidosPorSeg: getEnvInt("SALA_ADMITIDOS_POR_SEG", 50),
		Antibots:            getEnv("ANTIBOTS", "1") == "1",
		LimitePeticiones:    getEnvInt("LIMITE_PETICIONES", 60),
		VentanaSegundos:     getEnvInt("VENTANA_SEGUNDOS", 10),
		PoolMax:             getEnvInt("POOL_MAX", 50),
		PoolTimeoutSec:      getEnvFloat("POOL_TIMEOUT", 5.0),
		PagoLatenciaMs:      getEnvInt("PAGO_LATENCIA_MS", 200),
		AdminClave:          getEnv("ADMIN_CLAVE", ""),
		Secreto:             secreto,
		Puerto:              getEnv("PUERTO", "8000"),
		CulqiPublicKey:      getEnv("CULQI_LLAVE_PUBLICA", getEnv("CULQI_PUBLIC_KEY", "pk_test_7vR4Aqi7NhT2kKNF")),
		CulqiSecretKey:      getEnv("CULQI_LLAVE_PRIVADA", getEnv("CULQI_SECRET_KEY", "sk_test_Y3d18LZ4e6rZ0eL9")),
		ProveedorPago:       getEnv("PROVEEDOR_PAGO", "culqi"),
	}
}

func getEnv(key, def string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return def
}

func getEnvInt(key string, def int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return def
}

func getEnvFloat(key string, def float64) float64 {
	if val := os.Getenv(key); val != "" {
		if f, err := strconv.ParseFloat(val, 64); err == nil {
			return f
		}
	}
	return def
}

