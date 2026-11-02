"""Levanta el sistema por HTTPS con TLS 1.3 (RNF-04).

Uso:
    python scripts/servidor_tls.py                  # https en el puerto 8443
    python scripts/servidor_tls.py --puerto 9443
    python scripts/servidor_tls.py --minimo 1.2     # acepta también TLS 1.2

Por qué un script y no la línea de uvicorn: uvicorn deja poner el certificado,
pero no la versión mínima de TLS. Aquí se carga la configuración, se le fija
el mínimo en TLS 1.3 y luego se arranca, así el servidor rechaza cualquier
cliente que intente negociar una versión más vieja. Eso es lo que la prueba
con testssl.sh debe demostrar.

El servidor HTTP normal (puerto 8000) sigue existiendo y se usa para las
pruebas de carga, donde el cifrado solo agregaría ruido a la medición.
"""
import argparse
import ssl
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

import uvicorn  # noqa: E402

CLAVE = RAIZ / "certificados" / "clave.pem"
CERTIFICADO = RAIZ / "certificados" / "certificado.pem"

MINIMOS = {
    "1.2": ssl.TLSVersion.TLSv1_2,
    "1.3": ssl.TLSVersion.TLSv1_3,
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--puerto", type=int, default=8443)
    parser.add_argument("--host", default="0.0.0.0", help="0.0.0.0 para que lo vea la máquina virtual")
    parser.add_argument("--minimo", choices=sorted(MINIMOS), default="1.3",
                        help="versión mínima de TLS que se acepta")
    args = parser.parse_args()

    if not (CLAVE.exists() and CERTIFICADO.exists()):
        sys.exit(
            "Faltan los certificados. Créalos primero con:\n"
            "  .venv\\Scripts\\python scripts\\crear_certificado.py"
        )

    config = uvicorn.Config(
        "app.main:app",
        host=args.host,
        port=args.puerto,
        ssl_keyfile=str(CLAVE),
        ssl_certfile=str(CERTIFICADO),
    )
    servidor = uvicorn.Server(config)

    # load() construye el contexto TLS; recién después se le puede fijar el
    # mínimo. Al arrancar, uvicorn ve que ya está cargado y no lo rehace.
    config.load()
    config.ssl.minimum_version = MINIMOS[args.minimo]

    print(f"  HTTPS en https://127.0.0.1:{args.puerto}  (TLS {args.minimo} como mínimo)")
    print(f"  Desde Ubuntu en VirtualBox: https://10.0.2.2:{args.puerto}")
    print("  El certificado es autofirmado: el navegador avisará y hay que aceptar.")
    servidor.run()


if __name__ == "__main__":
    main()
