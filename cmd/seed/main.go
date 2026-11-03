package main

import (
	"context"
	"flag"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"pasarela-entradas/internal/config"
)

type SectorSeed struct {
	FilaPrefijo string
	Zona        string
	Precio      float64
	Cantidad    int
}

func reiniciarEsquema(ctx context.Context, pool *pgxpool.Pool) {
	log.Println("Reiniciando base de datos...")
	sqlFile := filepath.Join("sql", "esquema.sql")
	contenido, err := os.ReadFile(sqlFile)
	if err != nil {
		log.Fatalf("Error al leer sql/esquema.sql: %v", err)
	}
	if _, err := pool.Exec(ctx, string(contenido)); err != nil {
		log.Fatalf("Error ejecutando esquema.sql: %v", err)
	}
	log.Println("Esquema inicializado correctamente.")
}

func sembrarAsientosPauloLondra(ctx context.Context, pool *pgxpool.Pool, eventoID int) {
	sectores := []SectorSeed{
		{FilaPrefijo: "A", Zona: "Campo A", Precio: 270.00, Cantidad: 40},
		{FilaPrefijo: "B", Zona: "Campo B", Precio: 125.00, Cantidad: 40},
		{FilaPrefijo: "OCC-1", Zona: "Occidente 1", Precio: 185.00, Cantidad: 30},
		{FilaPrefijo: "OCC-2", Zona: "Occidente 2", Precio: 160.00, Cantidad: 30},
		{FilaPrefijo: "ORI-1", Zona: "Oriente 1", Precio: 185.00, Cantidad: 30},
		{FilaPrefijo: "ORI-2", Zona: "Oriente 2", Precio: 160.00, Cantidad: 30},
		{FilaPrefijo: "NORTE", Zona: "Tribuna Norte", Precio: 80.00, Cantidad: 40},
	}

	batch := &pgx.Batch{}
	total := 0

	for _, s := range sectores {
		for n := 1; n <= s.Cantidad; n++ {
			batch.Queue(`
				INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
				VALUES ($1, $2, $3, $4, $5, 'libre')
				ON CONFLICT DO NOTHING`,
				eventoID, s.FilaPrefijo, n, s.Precio, s.Zona)
			total++
		}
	}

	br := pool.SendBatch(ctx, batch)
	if err := br.Close(); err != nil {
		log.Fatalf("Error insertando asientos de Paulo Londra: %v", err)
	}
	log.Printf("Insertadas %d butacas en los 7 sectores oficiales.", total)
}

func main() {
	reiniciar := flag.Bool("reiniciar", true, "Reinicia esquema y carga únicamente Paulo Londra")
	flag.Parse()

	cfg := config.Cargar()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Error al conectar a PostgreSQL: %v", err)
	}
	defer pool.Close()

	if *reiniciar {
		reiniciarEsquema(ctx, pool)
	}

	// Asegurar que solo exista Paulo Londra
	_, _ = pool.Exec(ctx, "DELETE FROM eventos WHERE id <> 1")

	var eventoID int
	query := `
		INSERT INTO eventos (id, nombre, artista, categoria, lugar, fecha, afiche_url, imagen, descripcion)
		VALUES (1, 'PAULO LONDRA · TOUR 2026', 'Paulo Londra', 'Urbano / Trap', 'Estadio Nacional, Lima', '2026-08-29 21:00:00-05', '/img/concierto-internacional.svg', 'concierto-internacional.svg', 'El deseo de miles de fanáticos se hace realidad: Paulo Londra en el Estadio Nacional este sábado 29 de agosto de 2026. Organiza: CONCERTS SPORTS AEI10 S.A.C. Preventa con hasta 15% de descuento Interbank. Máximo 6 entradas por cliente.')
		ON CONFLICT (id) DO UPDATE SET
			nombre = EXCLUDED.nombre,
			artista = EXCLUDED.artista,
			categoria = EXCLUDED.categoria,
			lugar = EXCLUDED.lugar,
			fecha = EXCLUDED.fecha,
			descripcion = EXCLUDED.descripcion
		RETURNING id`
	if err := pool.QueryRow(ctx, query).Scan(&eventoID); err != nil {
		log.Fatalf("Error asegurando evento Paulo Londra: %v", err)
	}

	sembrarAsientosPauloLondra(ctx, pool, eventoID)
	log.Println("Cartelera configurada con éxito: Solo Paulo Londra - Estadio Nacional 2026.")
}
