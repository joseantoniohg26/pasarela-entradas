import asyncio
import hmac
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from psycopg_pool import PoolTimeout
from pydantic import BaseModel, Field

from app import config, db, entradas, metricas, pasarela_simulada, reportes, reservas
from app.antibots import LimitadorPeticiones
from app.sala_espera import SalaEspera

sala = SalaEspera(config.SALA_ADMITIDOS_POR_SEG, config.PASE_MINUTOS, config.SECRETO)
limitador = LimitadorPeticiones(config.LIMITE_PETICIONES, config.VENTANA_SEGUNDOS)


@asynccontextmanager
async def ciclo_de_vida(app):
    try:
        db.abrir()
    except Exception:
        raise SystemExit(
            "\n  No se pudo conectar a PostgreSQL.\n"
            "  - ¿Está iniciado el servicio de PostgreSQL?\n"
            "  - ¿La contraseña en DATABASE_URL (archivo .env) es la correcta?\n"
        )
    tarea = asyncio.create_task(sala.admitir_periodicamente())
    print(f"  Modo de reserva: {config.MODO_RESERVA} | Antibots: {'sí' if config.ANTIBOTS else 'no'}")
    yield
    tarea.cancel()
    db.cerrar()


app = FastAPI(
    title="Tiquetera - Pasarela de pagos para eventos masivos (Caso 2)",
    version="0.1.0",
    lifespan=ciclo_de_vida,
)
app.include_router(pasarela_simulada.router)


@app.middleware("http")
async def antibots(request: Request, call_next):
    if config.ANTIBOTS and request.url.path.startswith(("/api/", "/simulador-pasarela/")):
        ip = request.client.host if request.client else "desconocida"
        permitido, espera = limitador.permitir(ip)
        if not permitido:
            metricas.sumar("bloqueos_antibots")
            return JSONResponse(
                {"detail": "Demasiadas solicitudes. Espera unos segundos."},
                status_code=429,
                headers={"Retry-After": str(espera)},
            )
    return await call_next(request)


@app.exception_handler(PoolTimeout)
async def bd_saturada(request, exc):
    metricas.sumar("errores_bd_saturada")
    return JSONResponse({"detail": "Servicio saturado, intenta de nuevo"}, status_code=503)


def identificar_cliente(x_pase: str | None = Header(None), x_sesion: str | None = Header(None)):
    """En modo sala, el cliente es el ticket del pase (no se puede inventar).
    En los otros modos, se usa el identificador de sesión que manda el navegador."""
    if config.MODO_RESERVA == "sala":
        ticket = sala.validar_pase(x_pase) if x_pase else None
        if ticket is None:
            raise HTTPException(403, "Debes pasar por la sala de espera")
        return ticket
    if not x_sesion or len(x_sesion) > 64:
        raise HTTPException(400, "Falta la cabecera X-Sesion")
    return x_sesion


def verificar_admin(x_clave_admin: str | None = Header(None)):
    if not config.ADMIN_CLAVE:
        raise HTTPException(503, "Falta ADMIN_CLAVE en el archivo .env")
    if not x_clave_admin or not hmac.compare_digest(x_clave_admin, config.ADMIN_CLAVE):
        metricas.sumar("admin_clave_incorrecta")
        raise HTTPException(401, "Clave de administrador incorrecta")


# --- modelos -----------------------------------------------------------

class SolicitudReserva(BaseModel):
    asiento_id: int


class SolicitudValidacion(BaseModel):
    contenido: str = Field(min_length=4, max_length=200)


class SolicitudPago(BaseModel):
    asiento_id: int
    comprador: str = Field(min_length=3, max_length=80)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    token_pago: str = Field(min_length=8, max_length=64)


# --- información -------------------------------------------------------

@app.get("/api/config")
def ver_config():
    return {
        "modo": config.MODO_RESERVA,
        "reserva_minutos": config.RESERVA_MINUTOS,
        "max_entradas": config.MAX_ENTRADAS_POR_CLIENTE,
    }


@app.get("/api/salud")
def salud():
    return {
        "ok": True,
        "modo": config.MODO_RESERVA,
        "antibots": config.ANTIBOTS,
        "sala": sala.resumen(),
        "metricas": metricas.resumen(),
    }


@app.post("/api/metricas/reiniciar")
def reiniciar_metricas():
    metricas.reiniciar()
    return {"ok": True}


# --- sala de espera ----------------------------------------------------

@app.post("/api/sala/entrar")
async def entrar_a_sala():
    ticket, posicion = sala.entrar()
    metricas.sumar("sala_llegadas")
    return {"ticket": ticket, "posicion": posicion}


@app.get("/api/sala/{ticket}")
async def consultar_sala(ticket: str):
    estado = sala.consultar(ticket)
    if estado is None:
        raise HTTPException(404, "Ticket desconocido; vuelve a entrar a la sala")
    return estado


# --- eventos y asientos ------------------------------------------------

@app.get("/api/eventos")
def eventos():
    return reservas.listar_eventos()


@app.get("/api/eventos/{evento_id}")
def evento(evento_id: int):
    datos = reservas.obtener_evento(evento_id)
    if datos is None:
        raise HTTPException(404, "Ese evento no existe")
    return datos


@app.get("/api/eventos/{evento_id}/asientos")
def asientos(evento_id: int, x_pase: str | None = Header(None), x_sesion: str | None = Header(None)):
    cliente = sala.validar_pase(x_pase) if x_pase else x_sesion
    return reservas.listar_asientos(evento_id, cliente)


@app.post("/api/reservas", status_code=201)
def crear_reserva(datos: SolicitudReserva, cliente: str = Depends(identificar_cliente)):
    try:
        hasta = reservas.reservar(datos.asiento_id, cliente)
    except reservas.LimiteAlcanzado:
        metricas.sumar("reservas_sobre_limite")
        raise HTTPException(429, f"Máximo {config.MAX_ENTRADAS_POR_CLIENTE} entradas por cliente")
    if hasta is None:
        metricas.sumar("reservas_rechazadas")
        raise HTTPException(409, "Ese asiento ya no está disponible")
    metricas.sumar("reservas_ok")
    return {"asiento_id": datos.asiento_id, "reservado_hasta": hasta.isoformat()}


@app.delete("/api/reservas/{asiento_id}")
def cancelar_reserva(asiento_id: int, cliente: str = Depends(identificar_cliente)):
    if not reservas.liberar(asiento_id, cliente):
        raise HTTPException(404, "No tienes una reserva activa en ese asiento")
    return {"ok": True}


@app.post("/api/pagos", status_code=201)
def pagar(datos: SolicitudPago, cliente: str = Depends(identificar_cliente)):
    try:
        orden = reservas.pagar(datos.asiento_id, cliente, datos.comprador, datos.email, datos.token_pago)
    except reservas.ConflictoReserva as e:
        metricas.sumar("pagos_conflicto")
        raise HTTPException(409, str(e))
    except pasarela_simulada.ErrorPago as e:
        metricas.sumar("pagos_rechazados")
        raise HTTPException(402, str(e))
    metricas.sumar("pagos_ok")
    return orden


# --- entradas (QR) -----------------------------------------------------

@app.get("/api/entradas/{codigo}")
def ver_entrada(codigo: str, email: str):
    """La entrada se entrega solo si el correo coincide con el de la compra."""
    entrada = entradas.obtener(codigo, email)
    if entrada is None:
        metricas.sumar("entradas_no_encontradas")
        raise HTTPException(404, "No hay ninguna entrada con ese código y ese correo")
    return entrada


# --- panel de administrador --------------------------------------------

@app.get("/api/admin/resumen", dependencies=[Depends(verificar_admin)])
def admin_resumen():
    return reportes.resumen()


@app.post("/api/admin/validar", dependencies=[Depends(verificar_admin)])
def admin_validar(datos: SolicitudValidacion):
    """Control de acceso en la puerta: comprueba la firma del QR y marca la
    entrada como usada. Si se vuelve a escanear, responde 'repetida'."""
    estado, entrada = entradas.validar_en_puerta(datos.contenido)
    metricas.sumar("validaciones_" + estado)
    return {"estado": estado, "entrada": entrada}


app.mount("/", StaticFiles(directory=Path(__file__).parent.parent / "static", html=True), name="web")
