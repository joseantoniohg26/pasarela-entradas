"""Proveedor de pagos SIMULADO (hace el papel de Niubiz, Culqi, Stripe, etc.).

Igual que un proveedor real, la tarjeta se envía aquí para "tokenizarla" y
nuestro sistema de entradas solo recibe un token. Así el backend de la
tiquetera nunca ve ni guarda el número completo de la tarjeta, que es lo que
pide PCI-DSS para reducir el alcance de la auditoría.

Tarjetas de prueba:
    4111 1111 1111 1111  -> aprobada
    4000 0000 0000 0002  -> rechazada por el banco
"""
import secrets
import threading
import time
from datetime import date

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app import config

router = APIRouter(prefix="/simulador-pasarela", tags=["Proveedor de pagos (simulado)"])

_lock = threading.Lock()
_tokens = {}
_cargos = {}


class ErrorPago(Exception):
    pass


class DatosTarjeta(BaseModel):
    numero: str = Field(min_length=12, max_length=23)
    vencimiento: str = Field(pattern=r"^\d{2}/\d{2}$", examples=["12/28"])
    cvv: str = Field(pattern=r"^\d{3,4}$")
    titular: str = Field(min_length=3, max_length=80)


def _luhn_valido(numero):
    total = 0
    for i, digito in enumerate(reversed(numero)):
        d = int(digito)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _marca(numero):
    if numero.startswith("4"):
        return "Visa"
    if numero[:2] in {"51", "52", "53", "54", "55"}:
        return "Mastercard"
    if numero[:2] in {"34", "37"}:
        return "American Express"
    return "Otra"


def _vencida(vencimiento):
    mes, anio = (int(x) for x in vencimiento.split("/"))
    if not 1 <= mes <= 12:
        return True
    hoy = date.today()
    return (2000 + anio, mes) < (hoy.year, hoy.month)


@router.post("/tokenizar")
def tokenizar(datos: DatosTarjeta):
    numero = "".join(c for c in datos.numero if c.isdigit())
    if not 13 <= len(numero) <= 19 or not _luhn_valido(numero):
        raise HTTPException(422, "Número de tarjeta inválido")
    if _vencida(datos.vencimiento):
        raise HTTPException(422, "La tarjeta está vencida o la fecha es incorrecta")

    token = "tok_" + secrets.token_urlsafe(18)
    with _lock:
        _tokens[token] = {
            "ultimos4": numero[-4:],
            "marca": _marca(numero),
            "rechazar": numero.endswith("0002"),
            "usado": False,
            "creado": time.time(),
        }
    return {"token": token, "ultimos4": numero[-4:], "marca": _marca(numero)}


def cobrar(token, monto):
    """Cobra un monto con un token. Devuelve los datos del cargo o lanza ErrorPago."""
    time.sleep(config.PAGO_LATENCIA_MS / 1000)  # latencia de red del proveedor
    with _lock:
        datos = _tokens.get(token)
        if datos is None or time.time() - datos["creado"] > 900:
            raise ErrorPago("Token de pago inválido o expirado")
        if datos["usado"]:
            raise ErrorPago("Este token ya fue utilizado")
        datos["usado"] = True
        if datos["rechazar"]:
            raise ErrorPago("Pago rechazado por el banco emisor")
        cargo_id = "ch_" + secrets.token_urlsafe(12)
        _cargos[cargo_id] = {"monto": float(monto), "estado": "cobrado"}
    return {"cargo_id": cargo_id, "ultimos4": datos["ultimos4"], "marca": datos["marca"]}


def anular(cargo_id):
    with _lock:
        if cargo_id in _cargos:
            _cargos[cargo_id]["estado"] = "anulado"
