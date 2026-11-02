"""Consultas de solo lectura para el panel de administrador."""
from app.db import pool


def resumen():
    with pool().connection() as con:
        totales = con.execute(
            """SELECT count(*), coalesce(sum(monto), 0), count(*) FILTER (WHERE usado_en IS NOT NULL)
                 FROM ordenes"""
        ).fetchone()

        aforo = con.execute(
            """SELECT count(*),
                      count(*) FILTER (WHERE estado = 'vendido'),
                      count(*) FILTER (WHERE estado = 'reservado' AND reservado_hasta >= now())
                 FROM asientos"""
        ).fetchone()

        por_evento = con.execute(
            """SELECT e.id, e.nombre, e.fecha,
                      count(a.id) AS aforo,
                      count(a.id) FILTER (WHERE a.estado = 'vendido') AS vendidos,
                      count(a.id) FILTER (WHERE a.estado = 'reservado'
                                            AND a.reservado_hasta >= now()) AS reservados,
                      coalesce(sum(o.monto), 0) AS ingresos
                 FROM eventos e
                 LEFT JOIN asientos a ON a.evento_id = e.id
                 LEFT JOIN ordenes o ON o.asiento_id = a.id
                GROUP BY e.id ORDER BY e.fecha"""
        ).fetchall()

        ultimas = con.execute(
            """SELECT o.codigo, e.nombre, a.fila, a.numero, o.comprador,
                      o.monto, o.creado_en, o.usado_en
                 FROM ordenes o
                 JOIN asientos a ON a.id = o.asiento_id
                 JOIN eventos e ON e.id = a.evento_id
                ORDER BY o.creado_en DESC LIMIT 15"""
        ).fetchall()

    return {
        "entradas_vendidas": totales[0],
        "ingresos": float(totales[1]),
        "entradas_usadas": totales[2],
        "aforo_total": aforo[0],
        "asientos_vendidos": aforo[1],
        "asientos_reservados": aforo[2],
        "eventos": [
            {
                "id": f[0], "nombre": f[1], "fecha": f[2].isoformat(),
                "aforo": f[3], "vendidos": f[4], "reservados": f[5],
                "ingresos": float(f[6]),
                "ocupacion": round(f[4] / f[3] * 100, 1) if f[3] else 0.0,
            }
            for f in por_evento
        ],
        "ultimas_ordenes": [
            {
                "codigo": f[0], "evento": f[1], "asiento": f"{f[2]}-{f[3]}",
                "comprador": f[4], "monto": float(f[5]),
                "creado_en": f[6].isoformat(),
                "usado_en": f[7].isoformat() if f[7] else None,
            }
            for f in ultimas
        ],
    }
