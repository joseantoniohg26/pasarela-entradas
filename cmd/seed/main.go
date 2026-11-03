package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"pasarela-entradas/internal/config"
)

type EventoSeed struct {
	Nombre      string
	Lugar       string
	Fecha       time.Time
	AficheURL   string
	Filas       int
	PorFila     int
	PrecioVIP   float64
	PrecioPref  float64
	PrecioGen   float64
}

func main() {
	reiniciar := flag.Bool("reiniciar", false, "Borra las tablas existentes y las recrea")
	filasExtra := flag.Int("filas", 10, "Número de filas para el evento principal")
	porFilaExtra := flag.Int("por-fila", 20, "Asientos por fila para el evento principal")
	flag.Parse()

	cfg := config.Cargar()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("Error al conectar a PostgreSQL: %v", err)
	}
	defer pool.Close()

	if *reiniciar {
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

	var count int
	_ = pool.QueryRow(ctx, "SELECT count(*) FROM eventos").Scan(&count)
	if count > 0 && !*reiniciar {
		log.Println("La base de datos ya contiene eventos. Usa -reiniciar si deseas sobreescribir.")
		return
	}

	eventos := []EventoSeed{
		{
			Nombre:      "BTS · WORLD TOUR 'LIGHTS' LIMA 2026",
			Lugar:       "Estadio Nacional, Lima",
			Fecha:       time.Date(2026, 12, 15, 20, 0, 0, 0, time.Local),
			AficheURL:   "/img/concierto-internacional.svg",
			Filas:       *filasExtra,
			PorFila:     *porFilaExtra,
			PrecioVIP:   450.0,
			PrecioPref:  280.0,
			PrecioGen:   150.0,
		},
		{
			Nombre:      "Grupo 5 · 52 Años de Oro",
			Lugar:       "Estadio San Marcos, Lima",
			Fecha:       time.Date(2026, 12, 28, 21, 0, 0, 0, time.Local),
			AficheURL:   "/img/grupo5.jpg",
			Filas:       10,
			PorFila:     20,
			PrecioVIP:   300.0,
			PrecioPref:  180.0,
			PrecioGen:   95.0,
		},
		{
			Nombre:      "Libido en Concierto: La Reunión",
			Lugar:       "Arena 1, Costa Verde",
			Fecha:       time.Date(2027, 1, 20, 20, 30, 0, 0, time.Local),
			AficheURL:   "/img/libido.jpg",
			Filas:       8,
			PorFila:     15,
			PrecioVIP:   250.0,
			PrecioPref:  150.0,
			PrecioGen:   80.0,
		},
	}

	for _, ev := range eventos {
		var eventoID int
		err := pool.QueryRow(ctx, `
			INSERT INTO eventos (nombre, lugar, fecha, afiche_url)
			VALUES ($1, $2, $3, $4)
			RETURNING id`, ev.Nombre, ev.Lugar, ev.Fecha, ev.AficheURL).Scan(&eventoID)
		if err != nil {
			log.Fatalf("Error insertando evento: %v", err)
		}

		log.Printf("Insertando asientos para %s (Aforo: %d)...", ev.Nombre, ev.Filas*ev.PorFila)

		batch := &pgx.Batch{}
		for f := 0; f < ev.Filas; f++ {
			letraFila := string(rune('A' + f))
			for num := 1; num <= ev.PorFila; num++ {
				var zona string
				var precio float64
				if f < 2 {
					zona = "VIP"
					precio = ev.PrecioVIP
				} else if f < 5 {
					zona = "Preferencial"
					precio = ev.PrecioPref
				} else {
					zona = "General"
					precio = ev.PrecioGen
				}

				batch.Queue(`
					INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
					VALUES ($1, $2, $3, $4, $5, 'libre')`,
					eventoID, letraFila, num, precio, zona)
			}
		}

		br := pool.SendBatch(ctx, batch)
		if err := br.Close(); err != nil {
			log.Fatalf("Error insertando lote de asientos: %v", err)
		}
	}

	log.Println("Base de datos inicializada y poblada con éxito.")
}
