"""Crea el certificado autofirmado para servir el sistema por HTTPS (RNF-04).

Uso:
    python scripts/crear_certificado.py

Genera dos archivos en la carpeta `certificados`:
    clave.pem        -> la clave privada (no se sube a ningún repositorio)
    certificado.pem  -> el certificado público

El certificado incluye como nombres válidos `localhost`, `127.0.0.1` y
`10.0.2.2`, que es la dirección con la que la máquina virtual de VirtualBox ve
al Windows anfitrión. Así el mismo certificado sirve para probar desde Windows
y desde Ubuntu.

Es autofirmado: el navegador avisará que no conoce a quien lo emitió, lo cual
es normal en un prototipo. En producción lo firmaría una autoridad reconocida.
"""
import shutil
import subprocess
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CARPETA = RAIZ / "certificados"
CLAVE = CARPETA / "clave.pem"
CERTIFICADO = CARPETA / "certificado.pem"

# openssl viene incluido con Git para Windows; si no está en el PATH se busca ahí.
CANDIDATOS = [
    r"C:\Program Files\Git\usr\bin\openssl.exe",
    r"C:\Program Files\Git\mingw64\bin\openssl.exe",
]

NOMBRES = "subjectAltName=DNS:localhost,DNS:tiquetera.local,IP:127.0.0.1,IP:10.0.2.2"
IDENTIDAD = "/C=PE/ST=Madre de Dios/L=Puerto Maldonado/O=Tiquetera UNAMAD/CN=tiquetera.local"


def buscar_openssl():
    encontrado = shutil.which("openssl")
    if encontrado:
        return encontrado
    for ruta in CANDIDATOS:
        if Path(ruta).exists():
            return ruta
    sys.exit(
        "No se encontró openssl.\n"
        "  Viene con Git para Windows. Si tienes Git instalado, busca el archivo\n"
        "  openssl.exe dentro de C:\\Program Files\\Git y agrégalo a esta lista."
    )


def main():
    if CLAVE.exists() and CERTIFICADO.exists():
        print("El certificado ya existe. Bórralo si quieres crear uno nuevo:")
        print(f"  {CLAVE}")
        print(f"  {CERTIFICADO}")
        return

    CARPETA.mkdir(exist_ok=True)
    openssl = buscar_openssl()

    comando = [
        openssl, "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-sha256",
        "-days", "365",
        "-keyout", str(CLAVE),
        "-out", str(CERTIFICADO),
        "-subj", IDENTIDAD,
        "-addext", NOMBRES,
    ]
    resultado = subprocess.run(comando, capture_output=True, text=True)
    if resultado.returncode != 0:
        sys.exit("openssl falló:\n" + resultado.stderr)

    print(f"Certificado creado con {openssl}")
    print(f"  clave privada: {CLAVE}")
    print(f"  certificado:   {CERTIFICADO}")
    print("  válido para:   localhost, tiquetera.local, 127.0.0.1, 10.0.2.2 (365 días)")
    print("\nLevanta el servidor con HTTPS así:")
    print("  .venv\\Scripts\\python scripts\\servidor_tls.py")


if __name__ == "__main__":
    main()
