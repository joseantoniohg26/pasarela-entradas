"""Cambia el afiche de un evento por otra imagen.

Sirve para reemplazar los afiches dibujados por fotos reales.

Uso:
    1. Guarda la foto dentro de la carpeta static/img, por ejemplo grupo5.jpg
    2. python scripts/cambiar_afiche.py --evento 1 --imagen grupo5.jpg

Para ver los eventos con su afiche actual:
    python scripts/cambiar_afiche.py --listar
"""
import argparse
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import psycopg  # noqa: E402

from app import config  # noqa: E402

CARPETA = RAIZ / "static" / "img"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--listar", action="store_true", help="muestra los eventos y sus afiches")
    parser.add_argument("--evento", type=int, help="id del evento")
    parser.add_argument("--imagen", help="nombre del archivo dentro de static/img")
    args = parser.parse_args()

    con = psycopg.connect(config.DATABASE_URL)

    if args.listar or not (args.evento and args.imagen):
        print(f"{'id':>3}  {'evento':40}  afiche")
        for fila in con.execute("SELECT id, nombre, imagen FROM eventos ORDER BY id"):
            print(f"{fila[0]:>3}  {fila[1][:40]:40}  {fila[2]}")
        print(f"\nImágenes disponibles en {CARPETA}:")
        for archivo in sorted(CARPETA.iterdir()):
            print(f"  {archivo.name}")
        if not (args.evento and args.imagen):
            print("\nPara cambiar uno: --evento 1 --imagen grupo5.jpg")
        return

    if not (CARPETA / args.imagen).exists():
        sys.exit(f"No existe {CARPETA / args.imagen}. Guarda la imagen ahí primero.")

    with con:
        fila = con.execute(
            "UPDATE eventos SET imagen = %s WHERE id = %s RETURNING nombre",
            (args.imagen, args.evento),
        ).fetchone()

    if fila is None:
        sys.exit(f"No existe el evento {args.evento}")
    print(f"Listo: '{fila[0]}' ahora usa {args.imagen}")
    print("Recarga la página en el navegador (Ctrl + F5) para verlo.")


if __name__ == "__main__":
    main()
