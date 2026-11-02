"""Prueba RNF-03: Sobreventa = 0 %.

Muchos clientes distintos intentan reservar la MISMA butaca exactamente al
mismo tiempo. El sistema es correcto si solo UNO lo consigue.

Uso:
    python pruebas/sobreventa.py --url http://127.0.0.1:8000 --clientes 300

Desde Ubuntu en VirtualBox, el Windows anfitrión se ve como 10.0.2.2:
    python3 pruebas/sobreventa.py --url http://10.0.2.2:8000

Nota: para esta prueba pon ANTIBOTS=0 en el .env, porque todas las
peticiones salen de la misma IP y el limitador las bloquearía.
"""
import argparse
import asyncio
import time
import uuid
from collections import Counter

import httpx


async def conseguir_pases(cliente, cantidad):
    """Mete `cantidad` personas a la sala de espera y espera a que entren."""
    tickets = []
    for _ in range(cantidad):
        r = await cliente.post("/api/sala/entrar")
        r.raise_for_status()
        tickets.append(r.json()["ticket"])

    pases = {}
    inicio = time.time()
    while len(pases) < cantidad:
        pendientes = [t for t in tickets if t not in pases]
        respuestas = await asyncio.gather(*(cliente.get(f"/api/sala/{t}") for t in pendientes))
        for t, r in zip(pendientes, respuestas):
            if r.status_code == 200 and r.json()["estado"] == "admitido":
                pases[t] = r.json()["pase"]
        print(f"\r  Pases obtenidos: {len(pases)}/{cantidad}  ({time.time() - inicio:.0f} s)", end="")
        if len(pases) < cantidad:
            await asyncio.sleep(0.5)
    print()
    return list(pases.values())


async def primer_asiento_libre(cliente):
    eventos = (await cliente.get("/api/eventos")).json()
    asientos = (await cliente.get(f"/api/eventos/{eventos[0]['id']}/asientos")).json()
    for a in asientos:
        if a["estado"] == "libre":
            return a
    raise SystemExit("No quedan asientos libres. Ejecuta: python scripts/iniciar_bd.py --reiniciar")


async def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--clientes", type=int, default=300)
    args = parser.parse_args()

    limites = httpx.Limits(max_connections=args.clientes, max_keepalive_connections=args.clientes)
    async with httpx.AsyncClient(base_url=args.url, timeout=60, limits=limites) as cliente:
        cfg = (await cliente.get("/api/config")).json()
        asiento = await primer_asiento_libre(cliente)

        print("=" * 60)
        print("PRUEBA RNF-03 · Sobreventa = 0 %")
        print("=" * 60)
        print(f"  Servidor:        {args.url}")
        print(f"  Modo de reserva: {cfg['modo']}")
        print(f"  Asiento objetivo: fila {asiento['fila']}, n.º {asiento['numero']} (id {asiento['id']})")
        print(f"  Clientes simultáneos: {args.clientes}")

        if cfg["modo"] == "sala":
            print("  Pasando a los clientes por la sala de espera…")
            cabeceras = [{"X-Pase": p} for p in await conseguir_pases(cliente, args.clientes)]
        else:
            cabeceras = [{"X-Sesion": uuid.uuid4().hex} for _ in range(args.clientes)]

        salida = asyncio.Event()

        async def intentar(h):
            await salida.wait()          # todos esperan la misma señal de partida
            r = await cliente.post("/api/reservas", json={"asiento_id": asiento["id"]}, headers=h)
            return r.status_code

        tareas = [asyncio.create_task(intentar(h)) for h in cabeceras]
        await asyncio.sleep(0.2)
        inicio = time.perf_counter()
        salida.set()
        codigos = Counter(await asyncio.gather(*tareas))
        duracion = time.perf_counter() - inicio

    exitos = codigos.get(201, 0)
    print("-" * 60)
    print(f"  201 Reservado:         {exitos}")
    print(f"  409 Ya no disponible:  {codigos.get(409, 0)}")
    otros = {c: n for c, n in codigos.items() if c not in (201, 409)}
    if otros:
        print(f"  Otros códigos:         {otros}")
    print(f"  Tiempo total:          {duracion * 1000:.0f} ms")
    print("-" * 60)

    if 429 in codigos:
        print("  AVISO: hubo respuestas 429. Pon ANTIBOTS=0 en .env y reinicia el servidor.")
    if exitos == 1:
        print("  RESULTADO: CUMPLE. Un solo cliente obtuvo la butaca. Sobreventa = 0 %")
    elif exitos > 1:
        print(f"  RESULTADO: NO CUMPLE. {exitos} clientes 'ganaron' la misma butaca -> SOBREVENTA")
    else:
        print("  RESULTADO: nadie obtuvo la butaca; revisa los códigos de error.")


if __name__ == "__main__":
    asyncio.run(main())
