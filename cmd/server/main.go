package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"pasarela-entradas/internal/config"
	"pasarela-entradas/internal/handler"
	"pasarela-entradas/internal/repository"
	"pasarela-entradas/internal/service"
)

func main() {
	cfg := config.Cargar()

	// 1. Configurar Pool de conexiones PostgreSQL
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Error al parsear DATABASE_URL: %v", err)
	}
	poolCfg.MaxConns = int32(cfg.PoolMax)
	poolCfg.MinConns = 5
	poolCfg.MaxConnIdleTime = 5 * time.Minute
	poolCfg.MaxConnLifetime = 1 * time.Hour

	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(cfg.PoolTimeoutSec)*time.Second)
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	cancel()
	if err != nil {
		log.Fatalf("No se pudo conectar a PostgreSQL: %v\n- ¿Está activo el servicio de PostgreSQL?\n- ¿Verificaste las credenciales en .env?", err)
	}
	defer pool.Close()

	if err := pool.Ping(context.Background()); err != nil {
		log.Printf("Advertencia de conexión a BD: %v (asegúrate de que PostgreSQL esté corriendo)", err)
	}

	// 2. Instanciar Servicios del Núcleo
	sala := service.NuevaSalaEspera(cfg.SalaAdmitidosPorSeg, cfg.PaseMinutos, cfg.Secreto)
	pasarela := service.NuevaPasarela(cfg.PagoLatenciaMs)
	limiteIP := service.NuevoLimitador(cfg.LimitePeticiones, cfg.VentanaSegundos)
	entradas := service.NuevoServicioEntradas(cfg.Secreto)
	metricas := service.NuevasMetricas()

	// 3. Goroutine para el motor de admisión de la sala virtual
	stopSala := make(chan struct{})
	go sala.IniciarAdmitidor(stopSala)

	// 4. Repositorio y Handlers HTTP
	repo := repository.NuevoRepositorio(pool, cfg.ModoReserva, cfg.ReservaMinutos, cfg.MaxEntradasCliente)
	router := handler.NuevoRouter(handler.DependenciasRouter{
		Cfg:       cfg,
		Repo:      repo,
		Sala:      sala,
		Pasarela:  pasarela,
		LimiteIP:  limiteIP,
		Entradas:  entradas,
		Metricas:  metricas,
		StaticDir: "./static",
	})

	srv := &http.Server{
		Addr:         ":" + cfg.Puerto,
		Handler:      router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("Servidor de alta concurrencia en Go iniciado en http://localhost:%s", cfg.Puerto)
	log.Printf("Modo de reserva: %s | Antibots: %v | Admitidos/seg: %d", cfg.ModoReserva, cfg.Antibots, cfg.SalaAdmitidosPorSeg)

	// Manejo de apagado elegante (Graceful Shutdown)
	go func() {
		sigChan := make(chan os.Signal, 1)
		signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
		<-sigChan

		log.Println("Señal de apagado recibida. Deteniendo servicios...")
		close(stopSala)

		shutdownCtx, sCancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer sCancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("Error durante el cierre del servidor: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("Fallo crítico en el servidor HTTP: %v", err)
	}
	log.Println("Servidor cerrado ordenadamente.")
}
