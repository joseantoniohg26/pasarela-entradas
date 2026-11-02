"""Entradas: consulta, código QR y validación en la puerta.

El QR no guarda datos personales: lleva el código de la orden y una firma
HMAC hecha con SECRETO. Así, en la puerta se puede comprobar que la entrada
la emitimos nosotros sin necesidad de consultar nada más, y nadie puede
fabricar una entrada válida sin conocer la clave.

Contenido del QR:   TIQUETERA|ORD-1A2B3C4D|f3c9...   (código | firma)
"""
import hashlib
import hmac
import io

import segno

from app import config
from app.db import pool

PREFIJO = "TIQUETERA"

_SQL_ENTRADA = """
    SELECT o.codigo, o.comprador, o.email, o.monto, o.tarjeta_ultimos4,
           o.creado_en, o.usado_en,
           a.fila, a.numero, e.nombre, e.lugar, e.fecha
      FROM ordenes o
      JOIN asientos a ON a.id = o.asiento_id
      JOIN eventos e ON e.id = a.evento_id
"""


def firmar(codigo):
    """Firma corta (16 caracteres) del código, con la clave del sistema."""
    firma = hmac.new(config.SECRETO.encode(), codigo.encode(), hashlib.sha256)
    return firma.hexdigest()[:16]


def contenido_qr(codigo):
    return f"{PREFIJO}|{codigo}|{firmar(codigo)}"


def leer_contenido_qr(texto):
    """Devuelve el código si el texto escaneado es nuestro y la firma cuadra."""
    partes = (texto or "").strip().split("|")
    if len(partes) != 3 or partes[0] != PREFIJO:
        return None
    _, codigo, firma = partes
    # compare_digest: comparación en tiempo constante, para no filtrar
    # información sobre la firma correcta.
    if not hmac.compare_digest(firma, firmar(codigo)):
        return None
    return codigo


def qr_svg(contenido):
    """Devuelve el QR como SVG listo para incrustar en la página.

    Sin tamaño fijo (omitsize) para que el CSS decida cuán grande se ve, y
    sin declaración XML porque el SVG va dentro del HTML, no en un archivo."""
    salida = io.BytesIO()
    segno.make(contenido, error="m").save(
        salida, kind="svg", border=2, xmldecl=False, svgns=True,
        omitsize=True, svgclass=None, lineclass=None,
    )
    return salida.getvalue().decode("utf-8")


def _fila_a_entrada(f):
    return {
        "codigo": f[0],
        "comprador": f[1],
        "email": f[2],
        "monto": float(f[3]),
        "tarjeta_ultimos4": f[4],
        "comprado_en": f[5].isoformat(),
        "usado_en": f[6].isoformat() if f[6] else None,
        "asiento": f"{f[7]}-{f[8]}",
        "zona": "VIP" if f[3] >= 300 else ("Preferencial" if f[3] >= 200 else "General"),
        "evento": f[9],
        "lugar": f[10],
        "fecha": f[11].isoformat(),
    }


def obtener(codigo, email):
    """La entrada solo se entrega si el correo coincide con el de la compra.
    Con el código a secas no se puede ver el nombre ni el correo del comprador."""
    with pool().connection() as con:
        fila = con.execute(
            _SQL_ENTRADA + " WHERE o.codigo = %s AND lower(o.email) = lower(%s)",
            (codigo.strip().upper(), email.strip()),
        ).fetchone()
    if fila is None:
        return None
    entrada = _fila_a_entrada(fila)
    entrada["qr"] = qr_svg(contenido_qr(entrada["codigo"]))
    entrada["qr_texto"] = contenido_qr(entrada["codigo"])
    return entrada


def validar_en_puerta(texto_escaneado):
    """Marca la entrada como usada. Devuelve (estado, entrada).

    Se usa un UPDATE condicional, la misma técnica que evita la sobreventa:
    solo la primera validación encuentra `usado_en IS NULL`, así que una
    entrada no puede pasar dos veces aunque se escanee a la vez en dos puertas.
    """
    codigo = leer_contenido_qr(texto_escaneado)
    if codigo is None:
        return "invalida", None

    with pool().connection() as con, con.transaction():
        marcada = con.execute(
            "UPDATE ordenes SET usado_en = now() WHERE codigo = %s AND usado_en IS NULL RETURNING id",
            (codigo,),
        ).fetchone()
        fila = con.execute(_SQL_ENTRADA + " WHERE o.codigo = %s", (codigo,)).fetchone()

    if fila is None:
        return "no_existe", None
    return ("valida" if marcada else "repetida"), _fila_a_entrada(fila)
