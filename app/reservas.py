"""Reserva y compra de asientos.

Hay tres formas de reservar, según MODO_RESERVA, para poder comparar:

- inseguro: lee el estado y luego escribe, sin ningún control. Dos usuarios
  pueden leer "libre" a la vez y ambos creen que ganaron -> SOBREVENTA.
- directo:  bloqueo pesimista (SELECT ... FOR UPDATE). Es correcto, pero cada
  petición retiene un bloqueo y todo el tráfico llega a la base de datos.
- sala:     UPDATE condicional en una sola sentencia (atómico). Además, la
  sala de espera controla cuántos usuarios llegan aquí por segundo.
"""
import secrets
import time

from app import config, pasarela_simulada
from app.db import pool

_CONDICION_DISPONIBLE = """
    (estado = 'libre' OR (estado = 'reservado' AND reservado_hasta < now()))
"""

_SQL_MARCAR_RESERVADO = """
    UPDATE asientos
       SET estado = 'reservado',
           reservado_por = %(cliente)s,
           reservado_hasta = now() + make_interval(mins => %(minutos)s)
     WHERE id = %(id)s
"""


class LimiteAlcanzado(Exception):
    pass


class ConflictoReserva(Exception):
    pass


def _parametros(asiento_id, cliente):
    return {"id": asiento_id, "cliente": cliente, "minutos": config.RESERVA_MINUTOS}


def _verificar_limite(con, cliente):
    # El advisory lock serializa las peticiones de UN mismo cliente, para que
    # un bot no pueda saltarse el límite mandando muchas reservas a la vez.
    con.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (cliente,))
    cantidad = con.execute(
        """SELECT count(*) FROM asientos
            WHERE reservado_por = %s
              AND (estado = 'vendido' OR (estado = 'reservado' AND reservado_hasta >= now()))""",
        (cliente,),
    ).fetchone()[0]
    if cantidad >= config.MAX_ENTRADAS_POR_CLIENTE:
        raise LimiteAlcanzado()


def _reservar_atomico(asiento_id, cliente):
    with pool().connection() as con, con.transaction():
        _verificar_limite(con, cliente)
        fila = con.execute(
            _SQL_MARCAR_RESERVADO + " AND " + _CONDICION_DISPONIBLE + " RETURNING reservado_hasta",
            _parametros(asiento_id, cliente),
        ).fetchone()
    return fila[0] if fila else None


def _reservar_con_bloqueo(asiento_id, cliente):
    with pool().connection() as con, con.transaction():
        _verificar_limite(con, cliente)
        fila = con.execute(
            f"SELECT {_CONDICION_DISPONIBLE} FROM asientos WHERE id = %s FOR UPDATE",
            (asiento_id,),
        ).fetchone()
        if fila is None or not fila[0]:
            return None
        return con.execute(
            _SQL_MARCAR_RESERVADO + " RETURNING reservado_hasta",
            _parametros(asiento_id, cliente),
        ).fetchone()[0]


def _reservar_inseguro(asiento_id, cliente):
    with pool().connection() as con:
        fila = con.execute(
            f"SELECT {_CONDICION_DISPONIBLE} FROM asientos WHERE id = %s", (asiento_id,)
        ).fetchone()
        con.commit()
        if fila is None or not fila[0]:
            return None
        time.sleep(0.05)  # tiempo de procesamiento entre leer y escribir
        hasta = con.execute(
            _SQL_MARCAR_RESERVADO + " RETURNING reservado_hasta",
            _parametros(asiento_id, cliente),
        ).fetchone()[0]
        con.commit()
    return hasta


_ESTRATEGIAS = {
    "sala": _reservar_atomico,
    "directo": _reservar_con_bloqueo,
    "inseguro": _reservar_inseguro,
}


def reservar(asiento_id, cliente):
    """Devuelve la hora hasta la que queda reservado, o None si no estaba libre."""
    return _ESTRATEGIAS[config.MODO_RESERVA](asiento_id, cliente)


def liberar(asiento_id, cliente):
    with pool().connection() as con:
        cur = con.execute(
            """UPDATE asientos
                  SET estado = 'libre', reservado_por = NULL, reservado_hasta = NULL
                WHERE id = %s AND estado = 'reservado' AND reservado_por = %s""",
            (asiento_id, cliente),
        )
        return cur.rowcount == 1


_SQL_EVENTOS = """
    SELECT e.id, e.nombre, e.artista, e.categoria, e.lugar, e.fecha,
           e.imagen, e.descripcion,
           count(a.id) AS aforo,
           count(a.id) FILTER (WHERE a.estado <> 'vendido') AS disponibles,
           min(a.precio) AS precio_desde
      FROM eventos e LEFT JOIN asientos a ON a.evento_id = e.id
"""


def _fila_a_evento(f):
    return {
        "id": f[0], "nombre": f[1], "artista": f[2], "categoria": f[3],
        "lugar": f[4], "fecha": f[5].isoformat(), "imagen": f[6],
        "descripcion": f[7], "aforo": f[8], "disponibles": f[9],
        "precio_desde": float(f[10]) if f[10] is not None else None,
    }


def listar_eventos():
    with pool().connection() as con:
        filas = con.execute(_SQL_EVENTOS + " GROUP BY e.id ORDER BY e.fecha").fetchall()
    return [_fila_a_evento(f) for f in filas]


def obtener_evento(evento_id):
    """Devuelve un evento con sus zonas de precio, o None si no existe."""
    with pool().connection() as con:
        fila = con.execute(
            _SQL_EVENTOS + " WHERE e.id = %s GROUP BY e.id", (evento_id,)
        ).fetchone()
        if fila is None or fila[0] is None:
            return None
        zonas = con.execute(
            """SELECT precio, count(*) AS total,
                      count(*) FILTER (WHERE estado <> 'vendido') AS disponibles
                 FROM asientos WHERE evento_id = %s
                GROUP BY precio ORDER BY precio DESC""",
            (evento_id,),
        ).fetchall()

    evento = _fila_a_evento(fila)
    evento["zonas"] = [
        {"precio": float(z[0]), "total": z[1], "disponibles": z[2]} for z in zonas
    ]
    return evento


def listar_asientos(evento_id, cliente=None):
    with pool().connection() as con:
        filas = con.execute(
            """SELECT id, fila, numero, precio,
                      CASE WHEN estado = 'reservado' AND reservado_hasta < now()
                           THEN 'libre' ELSE estado END,
                      (estado = 'reservado' AND reservado_hasta >= now()
                       AND reservado_por = %(cliente)s),
                      reservado_hasta
                 FROM asientos
                WHERE evento_id = %(evento)s
                ORDER BY fila, numero""",
            {"evento": evento_id, "cliente": cliente},
        ).fetchall()
    return [
        {
            "id": f[0], "fila": f[1], "numero": f[2], "precio": float(f[3]),
            "estado": f[4], "mio": bool(f[5]),
            "reservado_hasta": f[6].isoformat() if f[5] else None,
        }
        for f in filas
    ]


def pagar(asiento_id, cliente, comprador, email, token_pago):
    # 1. La reserva debe seguir siendo de este cliente
    with pool().connection() as con:
        fila = con.execute(
            """SELECT precio FROM asientos
                WHERE id = %s AND estado = 'reservado'
                  AND reservado_por = %s AND reservado_hasta >= now()""",
            (asiento_id, cliente),
        ).fetchone()
    if fila is None:
        raise ConflictoReserva("Tu reserva expiró o el asiento no está reservado a tu nombre")
    precio = fila[0]

    # 2. Cobro con el proveedor (fuera de la transacción para no retener
    #    una conexión de la BD mientras esperamos al proveedor)
    cargo = pasarela_simulada.cobrar(token_pago, precio)

    # 3. Confirmar la venta. Si en el intermedio perdimos el asiento, se anula el cobro.
    codigo = "ORD-" + secrets.token_hex(4).upper()
    with pool().connection() as con, con.transaction():
        vendido = con.execute(
            """UPDATE asientos
                  SET estado = 'vendido', reservado_hasta = NULL
                WHERE id = %s AND estado = 'reservado' AND reservado_por = %s
            RETURNING id""",
            (asiento_id, cliente),
        ).fetchone()
        if vendido is None:
            pasarela_simulada.anular(cargo["cargo_id"])
            raise ConflictoReserva("El asiento ya no estaba disponible; el cobro fue anulado")
        con.execute(
            """INSERT INTO ordenes (codigo, asiento_id, comprador, email, monto,
                                    tarjeta_ultimos4, cargo_id)
               VALUES (%s, %s, %s, %s, %s, %s, %s)""",
            (codigo, asiento_id, comprador, email, precio, cargo["ultimos4"], cargo["cargo_id"]),
        )
    return {"codigo": codigo, "monto": float(precio), "tarjeta": f"{cargo['marca']} •••• {cargo['ultimos4']}"}
