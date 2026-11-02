"""Crea las tablas y carga la cartelera de eventos con sus asientos.

Uso:
    python scripts/iniciar_bd.py                 # crea tablas y datos si está vacía
    python scripts/iniciar_bd.py --reiniciar     # borra todo y vuelve a cargar
    python scripts/iniciar_bd.py --reiniciar --filas 26 --por-fila 40   # 1040 asientos

--filas y --por-fila cambian el aforo del primer evento, que es el que se usa
en las pruebas de carga y de sobreventa. Los demás tienen un aforo fijo.
"""
import argparse
import string
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import psycopg  # noqa: E402

from app import config  # noqa: E402

# Cada evento: nombre, artista, categoría, lugar, fecha, imagen, descripción.
# El primero es el evento principal (el de las pruebas) y por eso va primero
# en la cartelera: es el de fecha más cercana.
CARTELERA = [
    {
        "nombre": "Gran Concierto Internacional 2026",
        "artista": "Gira Mundial · Única fecha en Lima",
        "categoria": "Concierto",
        "lugar": "Estadio Nacional, Lima",
        "fecha": "2026-12-12 20:00-05",
        "imagen": "concierto-internacional.svg",
        "descripcion": (
            "La gira más esperada del año llega a Lima con una sola fecha. "
            "Dos horas y media de show, pantallas de 360 grados y la banda completa "
            "en el escenario del Estadio Nacional."
        ),
        "filas": 10,
        "por_fila": 20,
    },
    {
        "nombre": "Festival Rock en la Arena",
        "artista": "12 bandas · 2 escenarios",
        "categoria": "Festival",
        "lugar": "Arena 1, Costa Verde",
        "fecha": "2027-01-24 16:00-05",
        "imagen": "rock-arena.svg",
        "descripcion": (
            "Doce bandas nacionales e internacionales en dos escenarios frente al mar. "
            "La entrada incluye acceso a la zona de food trucks."
        ),
        "filas": 8,
        "por_fila": 14,
    },
    {
        "nombre": "Noche de Cumbia Peruana",
        "artista": "Las orquestas clásicas en vivo",
        "categoria": "Concierto",
        "lugar": "Explanada del Estadio Monumental",
        "fecha": "2027-02-07 19:00-05",
        "imagen": "cumbia.svg",
        "descripcion": (
            "Las orquestas que marcaron a varias generaciones, juntas en una sola noche. "
            "Cinco horas de cumbia sin parar y zona de baile sin asientos."
        ),
        "filas": 8,
        "por_fila": 14,
    },
    {
        "nombre": "Sinfónica: bandas sonoras de cine",
        "artista": "Orquesta Sinfónica Nacional",
        "categoria": "Sinfónico",
        "lugar": "Gran Teatro Nacional, San Borja",
        "fecha": "2027-03-14 19:30-05",
        "imagen": "sinfonica.svg",
        "descripcion": (
            "La Orquesta Sinfónica Nacional interpreta las bandas sonoras más conocidas "
            "del cine, acompañadas de proyecciones en pantalla gigante."
        ),
        "filas": 7,
        "por_fila": 12,
    },
    {
        "nombre": "Lima Beat: festival electrónico",
        "artista": "6 DJ internacionales",
        "categoria": "Festival",
        "lugar": "Jockey Club del Perú, Surco",
        "fecha": "2027-04-18 22:00-05",
        "imagen": "lima-beat.svg",
        "descripcion": (
            "Seis DJ internacionales desde las diez de la noche hasta el amanecer, "
            "con escenario principal al aire libre y carpa de música house."
        ),
        "filas": 8,
        "por_fila": 14,
    },
]


def precio_por_fila(indice):
    if indice < 3:
        return 350.00   # VIP
    if indice < 7:
        return 220.00   # Preferencial
    return 120.00       # General


def crear_evento(con, datos, filas, por_fila):
    evento_id = con.execute(
        """INSERT INTO eventos (nombre, artista, categoria, lugar, fecha, imagen, descripcion)
           VALUES (%(nombre)s, %(artista)s, %(categoria)s, %(lugar)s, %(fecha)s,
                   %(imagen)s, %(descripcion)s)
        RETURNING id""",
        datos,
    ).fetchone()[0]

    letras = string.ascii_uppercase[:filas]
    with con.cursor() as cur:
        cur.executemany(
            "INSERT INTO asientos (evento_id, fila, numero, precio) VALUES (%s, %s, %s, %s)",
            [
                (evento_id, letra, n, precio_por_fila(i))
                for i, letra in enumerate(letras)
                for n in range(1, por_fila + 1)
            ],
        )
    return filas * por_fila


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--reiniciar", action="store_true", help="borra los datos y vuelve a cargarlos")
    parser.add_argument("--filas", type=int, default=10, help="filas del evento principal")
    parser.add_argument("--por-fila", type=int, default=20, help="asientos por fila del evento principal")
    args = parser.parse_args()

    if not 1 <= args.filas <= 26:
        sys.exit("--filas debe estar entre 1 y 26 (A-Z)")

    try:
        con = psycopg.connect(config.DATABASE_URL)
    except psycopg.OperationalError as e:
        sys.exit(f"No se pudo conectar a PostgreSQL. Revisa DATABASE_URL en el archivo .env\n{e}")

    with con:
        con.execute((RAIZ / "sql" / "esquema.sql").read_text(encoding="utf-8"))

        if args.reiniciar:
            con.execute("TRUNCATE ordenes, asientos, eventos RESTART IDENTITY CASCADE")

        if con.execute("SELECT count(*) FROM eventos").fetchone()[0] > 0:
            print("La base ya tiene datos. Usa --reiniciar para empezar de cero.")
            return

        total = 0
        for posicion, evento in enumerate(CARTELERA):
            filas = args.filas if posicion == 0 else evento["filas"]
            por_fila = args.por_fila if posicion == 0 else evento["por_fila"]
            total += crear_evento(con, evento, filas, por_fila)

    print(f"Listo: {len(CARTELERA)} eventos con {total} asientos en total.")
    print(f"Evento principal (pruebas): {CARTELERA[0]['nombre']} con {args.filas * args.por_fila} asientos.")


if __name__ == "__main__":
    main()
