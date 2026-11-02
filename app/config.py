import os
import secrets

from dotenv import load_dotenv

load_dotenv()


def _entero(nombre, defecto):
    return int(os.getenv(nombre, defecto))


DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/pasarela"
)

MODO_RESERVA = os.getenv("MODO_RESERVA", "sala").strip().lower()
MODOS_VALIDOS = ("sala", "directo", "inseguro")
if MODO_RESERVA not in MODOS_VALIDOS:
    raise SystemExit(f"MODO_RESERVA debe ser uno de {MODOS_VALIDOS}, no '{MODO_RESERVA}'")

# Tiempos de negocio
RESERVA_MINUTOS = _entero("RESERVA_MINUTOS", 5)
PASE_MINUTOS = _entero("PASE_MINUTOS", 15)
MAX_ENTRADAS_POR_CLIENTE = _entero("MAX_ENTRADAS_POR_CLIENTE", 4)

# Sala de espera
SALA_ADMITIDOS_POR_SEG = _entero("SALA_ADMITIDOS_POR_SEG", 50)

# Antibots (limitador por IP)
ANTIBOTS = os.getenv("ANTIBOTS", "1") == "1"
LIMITE_PETICIONES = _entero("LIMITE_PETICIONES", 60)
VENTANA_SEGUNDOS = _entero("VENTANA_SEGUNDOS", 10)

# Base de datos
POOL_MAX = _entero("POOL_MAX", 20)
POOL_TIMEOUT = float(os.getenv("POOL_TIMEOUT", "5"))

# Proveedor de pagos simulado
PAGO_LATENCIA_MS = _entero("PAGO_LATENCIA_MS", 200)

# Clave del panel de administrador
ADMIN_CLAVE = os.getenv("ADMIN_CLAVE", "")

# Clave para firmar los pases de la sala y los QR de las entradas. Si no se
# define, se genera una nueva en cada arranque (los pases y los QR anteriores
# dejan de valer).
SECRETO = os.getenv("SECRETO") or secrets.token_hex(32)
