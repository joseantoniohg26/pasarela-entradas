package repository

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"pasarela-entradas/internal/domain"
)

type Repositorio struct {
	pool               *pgxpool.Pool
	modoReserva        string
	reservaMinutos     int
	maxEntradasCliente int
}

func NuevoRepositorio(pool *pgxpool.Pool, modo string, resMinutos, maxEntradas int) *Repositorio {
	return &Repositorio{
		pool:               pool,
		modoReserva:        modo,
		reservaMinutos:     resMinutos,
		maxEntradasCliente: maxEntradas,
	}
}

func (r *Repositorio) ListarEventos(ctx context.Context) ([]domain.Evento, error) {
	query := `SELECT id, nombre, lugar, fecha, afiche_url FROM eventos ORDER BY fecha`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lista []domain.Evento
	for rows.Next() {
		var e domain.Evento
		if err := rows.Scan(&e.ID, &e.Nombre, &e.Lugar, &e.Fecha, &e.AficheURL); err != nil {
			return nil, err
		}
		lista = append(lista, e)
	}
	return lista, nil
}

func (r *Repositorio) ObtenerEvento(ctx context.Context, id int) (*domain.Evento, error) {
	query := `SELECT id, nombre, lugar, fecha, afiche_url FROM eventos WHERE id = $1`
	var e domain.Evento
	err := r.pool.QueryRow(ctx, query, id).Scan(&e.ID, &e.Nombre, &e.Lugar, &e.Fecha, &e.AficheURL)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &e, nil
}

func (r *Repositorio) ListarAsientos(ctx context.Context, eventoID int, cliente string) ([]domain.Asiento, error) {
	query := `SELECT id, fila, numero, precio, zona, estado, reservado_por, reservado_hasta
	          FROM asientos WHERE evento_id = $1 ORDER BY fila, numero`
	rows, err := r.pool.Query(ctx, query, eventoID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var lista []domain.Asiento
	ahora := time.Now()

	for rows.Next() {
		var a domain.Asiento
		var reservadoPor *string
		var resHasta *time.Time

		if err := rows.Scan(&a.ID, &a.Fila, &a.Numero, &a.Precio, &a.Zona, &a.Estado, &reservadoPor, &resHasta); err != nil {
			return nil, err
		}

		if a.Estado == "reservado" && resHasta != nil && resHasta.Before(ahora) {
			a.Estado = "libre"
			resHasta = nil
		}

		if cliente != "" && reservadoPor != nil && *reservadoPor == cliente && a.Estado == "reservado" {
			a.EsMio = true
			a.ReservadoHasta = resHasta
		} else {
			a.EsMio = false
			a.ReservadoHasta = nil
		}
		lista = append(lista, a)
	}
	return lista, nil
}

func (r *Repositorio) verificarLimite(ctx context.Context, tx pgx.Tx, cliente string) error {
	var dummy int
	// Lock consultivo para serializar peticiones concurrentes del mismo cliente
	_ = tx.QueryRow(ctx, "SELECT pg_advisory_xact_lock(hashtext($1))", cliente).Scan(&dummy)

	var cant int
	query := `SELECT count(*) FROM asientos
	           WHERE reservado_por = $1
	             AND (estado = 'vendido' OR (estado = 'reservado' AND reservado_hasta >= now()))`
	err := tx.QueryRow(ctx, query, cliente).Scan(&cant)
	if err != nil {
		return err
	}
	if cant >= r.maxEntradasCliente {
		return domain.ErrLimiteAlcanzado
	}
	return nil
}

func (r *Repositorio) Reservar(ctx context.Context, asientoID int, cliente string) (*time.Time, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := r.verificarLimite(ctx, tx, cliente); err != nil {
		return nil, err
	}

	intervalo := fmt.Sprintf("%d minutes", r.reservaMinutos)

	switch r.modoReserva {
	case "directo":
		var disponible bool
		checkQuery := `SELECT (estado = 'libre' OR (estado = 'reservado' AND reservado_hasta < now()))
		                 FROM asientos WHERE id = $1 FOR UPDATE`
		err := tx.QueryRow(ctx, checkQuery, asientoID).Scan(&disponible)
		if errors.Is(err, pgx.ErrNoRows) || !disponible {
			return nil, domain.ErrAsientoNoDisponible
		}
		if err != nil {
			return nil, err
		}

		updateQuery := `UPDATE asientos
		                   SET estado = 'reservado',
		                       reservado_por = $1,
		                       reservado_hasta = now() + $2::interval
		                 WHERE id = $3
		             RETURNING reservado_hasta`
		var hasta time.Time
		err = tx.QueryRow(ctx, updateQuery, cliente, intervalo, asientoID).Scan(&hasta)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &hasta, nil

	case "inseguro":
		var estado string
		var resHasta *time.Time
		err := tx.QueryRow(ctx, "SELECT estado, reservado_hasta FROM asientos WHERE id = $1", asientoID).Scan(&estado, &resHasta)
		if err != nil {
			return nil, domain.ErrAsientoNoDisponible
		}
		disponible := estado == "libre" || (estado == "reservado" && resHasta != nil && resHasta.Before(time.Now()))
		if !disponible {
			return nil, domain.ErrAsientoNoDisponible
		}

		time.Sleep(30 * time.Millisecond) // Simula ventana de carrera vulnerable

		updateQuery := `UPDATE asientos
		                   SET estado = 'reservado',
		                       reservado_por = $1,
		                       reservado_hasta = now() + $2::interval
		                 WHERE id = $3
		             RETURNING reservado_hasta`
		var hasta time.Time
		err = tx.QueryRow(ctx, updateQuery, cliente, intervalo, asientoID).Scan(&hasta)
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &hasta, nil

	default: // "sala" (UPDATE Atómico Optimista)
		updateQuery := `UPDATE asientos
		                   SET estado = 'reservado',
		                       reservado_por = $1,
		                       reservado_hasta = now() + $2::interval
		                 WHERE id = $3
		                   AND (estado = 'libre' OR (estado = 'reservado' AND reservado_hasta < now()))
		             RETURNING reservado_hasta`
		var hasta time.Time
		err := tx.QueryRow(ctx, updateQuery, cliente, intervalo, asientoID).Scan(&hasta)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, domain.ErrAsientoNoDisponible
		}
		if err != nil {
			return nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, err
		}
		return &hasta, nil
	}
}

func (r *Repositorio) Liberar(ctx context.Context, asientoID int, cliente string) (bool, error) {
	query := `UPDATE asientos
	             SET estado = 'libre',
	                 reservado_por = NULL,
	                 reservado_hasta = NULL
	           WHERE id = $1
	             AND reservado_por = $2
	             AND estado = 'reservado'`
	tag, err := r.pool.Exec(ctx, query, asientoID, cliente)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (r *Repositorio) PagarYConfirmar(ctx context.Context, asientoID int, cliente, comprador, email, ultimos4 string) (*domain.Orden, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var precio float64
	var reservadoPor *string
	var estado string
	var resHasta *time.Time

	checkQuery := `SELECT precio, reservado_por, estado, reservado_hasta
	                 FROM asientos WHERE id = $1 FOR UPDATE`
	err = tx.QueryRow(ctx, checkQuery, asientoID).Scan(&precio, &reservadoPor, &estado, &resHasta)
	if err != nil {
		return nil, domain.ErrAsientoNoDisponible
	}

	if estado == "vendido" {
		return nil, errors.New("este asiento ya fue comprado")
	}

	pertenece := reservadoPor != nil && *reservadoPor == cliente
	activo := estado == "reservado" && resHasta != nil && resHasta.After(time.Now())

	if !pertenece || !activo {
		return nil, domain.ErrConflictoReserva
	}

	_, err = tx.Exec(ctx, `UPDATE asientos
	                          SET estado = 'vendido',
	                              reservado_por = $1,
	                              reservado_hasta = NULL
	                        WHERE id = $2`, cliente, asientoID)
	if err != nil {
		return nil, err
	}

	bytes := make([]byte, 4)
	_, _ = rand.Read(bytes)
	codigo := fmt.Sprintf("ORD-%s", strings.ToUpper(hex.EncodeToString(bytes)))

	insertQuery := `INSERT INTO ordenes (codigo, asiento_id, comprador, email, monto, tarjeta_ultimos4)
	                VALUES ($1, $2, $3, $4, $5, $6)
	             RETURNING creado_en`
	var creadoEn time.Time
	err = tx.QueryRow(ctx, insertQuery, codigo, asientoID, comprador, email, precio, ultimos4).Scan(&creadoEn)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &domain.Orden{
		Codigo:          codigo,
		AsientoID:       asientoID,
		Comprador:       comprador,
		Email:           email,
		Monto:           precio,
		TarjetaUltimos4: ultimos4,
		CreadoEn:        creadoEn,
	}, nil
}

func (r *Repositorio) ObtenerEntrada(ctx context.Context, codigo, email string) (*domain.DetalleEntrada, error) {
	query := `SELECT o.codigo, o.comprador, o.email, o.monto, o.tarjeta_ultimos4,
	                 o.creado_en, o.usado_en,
	                 a.fila, a.numero, e.nombre, e.lugar, e.fecha
	            FROM ordenes o
	            JOIN asientos a ON a.id = o.asiento_id
	            JOIN eventos e ON e.id = a.evento_id
	           WHERE o.codigo = $1 AND o.email = $2`

	var d domain.DetalleEntrada
	var fila string
	var numero int

	err := r.pool.QueryRow(ctx, query, codigo, email).Scan(
		&d.Codigo, &d.Comprador, &d.Email, &d.Monto, &d.TarjetaUltimos4,
		&d.CompradoEn, &d.UsadoEn,
		&fila, &numero, &d.Evento, &d.Lugar, &d.Fecha,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	d.Asiento = fmt.Sprintf("%s-%d", fila, numero)
	if d.Monto >= 300 {
		d.Zona = "VIP"
	} else if d.Monto >= 200 {
		d.Zona = "Preferencial"
	} else {
		d.Zona = "General"
	}

	return &d, nil
}

func (r *Repositorio) MarcarEntradaUsada(ctx context.Context, codigo string) (string, *domain.DetalleEntrada, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return "", nil, err
	}
	defer tx.Rollback(ctx)

	query := `SELECT o.codigo, o.comprador, o.email, o.monto, o.tarjeta_ultimos4,
	                 o.creado_en, o.usado_en,
	                 a.fila, a.numero, e.nombre, e.lugar, e.fecha
	            FROM ordenes o
	            JOIN asientos a ON a.id = o.asiento_id
	            JOIN eventos e ON e.id = a.evento_id
	           WHERE o.codigo = $1 FOR UPDATE`

	var d domain.DetalleEntrada
	var fila string
	var numero int

	err = tx.QueryRow(ctx, query, codigo).Scan(
		&d.Codigo, &d.Comprador, &d.Email, &d.Monto, &d.TarjetaUltimos4,
		&d.CompradoEn, &d.UsadoEn,
		&fila, &numero, &d.Evento, &d.Lugar, &d.Fecha,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return "no_existe", nil, nil
	}
	if err != nil {
		return "", nil, err
	}

	d.Asiento = fmt.Sprintf("%s-%d", fila, numero)

	if d.UsadoEn != nil {
		return "repetida", &d, nil
	}

	ahora := time.Now()
	_, err = tx.Exec(ctx, "UPDATE ordenes SET usado_en = $1 WHERE codigo = $2", ahora, codigo)
	if err != nil {
		return "", nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", nil, err
	}

	d.UsadoEn = &ahora
	return "valida", &d, nil
}

func (r *Repositorio) ResumenAdmin(ctx context.Context) (*domain.ResumenReporte, error) {
	var rep domain.ResumenReporte

	queryTotales := `SELECT count(*), coalesce(sum(monto), 0), count(*) FILTER (WHERE usado_en IS NOT NULL) FROM ordenes`
	if err := r.pool.QueryRow(ctx, queryTotales).Scan(&rep.EntradasVendidas, &rep.Ingresos, &rep.EntradasUsadas); err != nil {
		return nil, err
	}

	queryAforo := `SELECT count(*),
	                      count(*) FILTER (WHERE estado = 'vendido'),
	                      count(*) FILTER (WHERE estado = 'reservado' AND reservado_hasta >= now())
	                 FROM asientos`
	if err := r.pool.QueryRow(ctx, queryAforo).Scan(&rep.AforoTotal, &rep.AsientosVendidos, &rep.AsientosReservados); err != nil {
		return nil, err
	}

	queryEventos := `SELECT e.id, e.nombre, e.fecha,
	                        count(a.id) AS aforo,
	                        count(a.id) FILTER (WHERE a.estado = 'vendido') AS vendidos,
	                        count(a.id) FILTER (WHERE a.estado = 'reservado' AND a.reservado_hasta >= now()) AS reservados,
	                        coalesce(sum(o.monto), 0) AS ingresos
	                   FROM eventos e
	                   LEFT JOIN asientos a ON a.evento_id = e.id
	                   LEFT JOIN ordenes o ON o.asiento_id = a.id
	                  GROUP BY e.id ORDER BY e.fecha`
	rowsE, err := r.pool.Query(ctx, queryEventos)
	if err != nil {
		return nil, err
	}
	defer rowsE.Close()

	for rowsE.Next() {
		var ev domain.EventoReporte
		if err := rowsE.Scan(&ev.ID, &ev.Nombre, &ev.Fecha, &ev.Aforo, &ev.Vendidos, &ev.Reservados, &ev.Ingresos); err != nil {
			return nil, err
		}
		if ev.Aforo > 0 {
			ev.Ocupacion = float64(ev.Vendidos) / float64(ev.Aforo) * 100.0
		}
		rep.Eventos = append(rep.Eventos, ev)
	}

	queryOrdenes := `SELECT o.codigo, e.nombre, a.fila, a.numero, o.comprador, o.monto, o.creado_en, o.usado_en
	                   FROM ordenes o
	                   JOIN asientos a ON a.id = o.asiento_id
	                   JOIN eventos e ON e.id = a.evento_id
	                  ORDER BY o.creado_en DESC LIMIT 15`
	rowsO, err := r.pool.Query(ctx, queryOrdenes)
	if err != nil {
		return nil, err
	}
	defer rowsO.Close()

	for rowsO.Next() {
		var ord domain.OrdenReporte
		var fila string
		var num int
		if err := rowsO.Scan(&ord.Codigo, &ord.Evento, &fila, &num, &ord.Comprador, &ord.Monto, &ord.CreadoEn, &ord.UsadoEn); err != nil {
			return nil, err
		}
		ord.Asiento = fmt.Sprintf("%s-%d", fila, num)
		rep.UltimasOrdenes = append(rep.UltimasOrdenes, ord)
	}

	return &rep, nil
}

