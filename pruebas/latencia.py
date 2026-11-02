"""Prueba RNF-02: tiempo de reserva <= 300 ms, y comparación del trade-off.

Muchos clientes reservan asientos DISTINTOS al mismo tiempo y se mide cuánto
tarda cada reserva. A diferencia de sobreventa.py (donde todos pelean por la
misma butaca), aquí interesa el tiempo, no el conflicto.

Uso:
    python3 pruebas/latencia.py --clientes 100               # todos a la vez (peor caso)
    python3 pruebas/latencia.py --clientes 100 --ritmo 50    # 50 clientes por segundo
    python3 pruebas/latencia.py --url http://10.0.2.2:8000 --clientes 200

Hay dos escenarios y conviene mostrar los dos:

- Sin --ritmo: las reservas salen todas en el mismo instante. Es el peor caso
  posible y deja ver dónde se satura el sistema.
- Con --ritmo N: los clientes llegan a N por segundo. Es el escenario que la
  arquitectura promete, porque la sala de espera no deja entrar a más de
  SALA_ADMITIDOS_POR_SEG por segundo. Este es el número que se compara con el
  RNF-02.
- Con --mismo-asiento: todos pelean por la MISMA butaca. Solo uno gana y el
  resto recibe 409, pero lo que interesa es cuánto tardan en recibir respuesta.
  Aquí sí se nota la diferencia entre modos: `directo` usa SELECT ... FOR UPDATE
  y cada cliente espera su turno en la fila del bloqueo, mientras que `sala`
  resuelve con un UPDATE condicional que contesta de inmediato. Este es el
  escenario que demuestra el trade-off del PPT.

Para el trade-off se corre dos veces, cambiando MODO_RESERVA en el .env y
reiniciando el servidor:

    MODO_RESERVA=sala     -> sala de espera + UPDATE atómico
    MODO_RESERVA=directo  -> sin sala, SELECT ... FOR UPDATE

Requisitos:
    - ANTIBOTS=0 en el .env (todas las peticiones salen de la misma IP).
    - Solo usa la librería estándar de Python: no hay que instalar nada.
"""
import argparse
import json
import ssl
import statistics
import threading
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

# El certificado del servidor HTTPS es autofirmado
SIN_VERIFICAR = ssl.create_default_context()
SIN_VERIFICAR.check_hostname = False
SIN_VERIFICAR.verify_mode = ssl.CERT_NONE


def pedir(url, cuerpo=None, metodo="GET", cabeceras=None, timeout=30):
    """Devuelve (codigo, datos). No lanza excepción con los errores HTTP."""
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    peticion = urllib.request.Request(url, data=datos, method=metodo)
    peticion.add_header("Content-Type", "application/json")
    for nombre, valor in (cabeceras or {}).items():
        peticion.add_header(nombre, valor)
    try:
        with urllib.request.urlopen(peticion, timeout=timeout, context=SIN_VERIFICAR) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, None
    except Exception as e:
        return 0, {"detail": str(e)}


def percentil(valores, p):
    """Percentil por el método del más cercano, suficiente para el informe."""
    if not valores:
        return 0.0
    ordenados = sorted(valores)
    posicion = min(len(ordenados) - 1, int(round(p / 100 * len(ordenados) + 0.5)) - 1)
    return ordenados[posicion]


def conseguir_pase(base):
    """Pasa un cliente por la sala de espera y devuelve su pase."""
    codigo, r = pedir(f"{base}/api/sala/entrar", metodo="POST")
    if codigo != 200:
        return None
    ticket = r["ticket"]
    limite = time.time() + 120
    while time.time() < limite:
        codigo, r = pedir(f"{base}/api/sala/{ticket}")
        if codigo == 200 and r["estado"] == "admitido":
            return r["pase"]
        time.sleep(0.4)
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--clientes", type=int, default=100)
    parser.add_argument("--evento", type=int, default=1)
    parser.add_argument("--ritmo", type=float, default=0,
                        help="clientes por segundo; 0 = todos a la vez")
    parser.add_argument("--mismo-asiento", action="store_true",
                        help="todos reservan la misma butaca (demuestra el trade-off)")
    parser.add_argument("--guardar", help="archivo donde dejar el resultado en JSON")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    codigo, cfg = pedir(f"{base}/api/config")
    if codigo != 200:
        raise SystemExit(f"No se pudo hablar con {base}: {cfg}")
    modo = cfg["modo"]

    codigo, asientos = pedir(f"{base}/api/eventos/{args.evento}/asientos")
    libres = [a["id"] for a in asientos if a["estado"] == "libre"]
    if args.mismo_asiento and libres:
        libres = [libres[0]] * args.clientes       # todos contra la misma butaca
    if len(libres) < args.clientes:
        raise SystemExit(
            f"Solo hay {len(libres)} asientos libres y se piden {args.clientes}.\n"
            "Libera el aforo con: python scripts/iniciar_bd.py --reiniciar"
        )

    print("=" * 64)
    print("PRUEBA RNF-02 · Tiempo de reserva <= 300 ms")
    print("=" * 64)
    print(f"  Servidor:             {base}")
    print(f"  Modo de reserva:      {modo}")
    if args.mismo_asiento:
        print("  Objetivo:             todos contra la MISMA butaca (contención)")
    else:
        print("  Objetivo:             cada cliente una butaca distinta")
    if args.ritmo:
        print(f"  Llegada:              {args.ritmo:.0f} clientes por segundo")
    else:
        print("  Llegada:              todos en el mismo instante (peor caso)")
    print(f"  Clientes:             {args.clientes}")
    print(f"  Asientos libres:      {len(libres)}")

    # Cada cliente necesita su propia identidad antes de que empiece la medición,
    # para que el tiempo de la sala de espera no se mezcle con el de la reserva.
    print("  Preparando clientes…", end="", flush=True)
    identidades = []
    if modo == "sala":
        hilos = []
        resultados = [None] * args.clientes
        def preparar(i):
            resultados[i] = conseguir_pase(base)
        for i in range(args.clientes):
            h = threading.Thread(target=preparar, args=(i,))
            h.start()
            hilos.append(h)
        for h in hilos:
            h.join()
        identidades = [{"X-Pase": p} for p in resultados if p]
    else:
        identidades = [{"X-Sesion": uuid.uuid4().hex} for _ in range(args.clientes)]
    print(f" {len(identidades)} listos")

    if len(identidades) < args.clientes:
        print(f"  AVISO: solo {len(identidades)} clientes consiguieron pase.")

    # Sin ritmo, todos los hilos esperan la misma señal y salen juntos.
    # Con ritmo, cada hilo arranca cuando le toca y la barrera no se usa.
    a_la_vez = args.ritmo == 0
    partida = threading.Barrier(len(identidades) + 1) if a_la_vez else None
    medidas = []
    codigos = {}
    cerrojo = threading.Lock()

    def reservar(cabeceras, asiento_id):
        if a_la_vez:
            partida.wait()
        inicio = time.perf_counter()
        codigo, _ = pedir(f"{base}/api/reservas", {"asiento_id": asiento_id}, "POST", cabeceras)
        tardanza = (time.perf_counter() - inicio) * 1000
        with cerrojo:
            codigos[codigo] = codigos.get(codigo, 0) + 1
            # Se mide toda respuesta: quien pierde la butaca también estuvo
            # esperando, y el RNF-02 habla del tiempo de respuesta del endpoint.
            medidas.append(tardanza)

    hilos = []
    espaciado = 0 if a_la_vez else 1 / args.ritmo
    inicio_total = time.perf_counter()
    for i, cabeceras in enumerate(identidades):
        h = threading.Thread(target=reservar, args=(cabeceras, libres[i]))
        h.start()
        hilos.append(h)
        if espaciado:
            time.sleep(espaciado)

    if a_la_vez:
        time.sleep(0.3)
        inicio_total = time.perf_counter()
        partida.wait()
    for h in hilos:
        h.join()
    duracion_total = time.perf_counter() - inicio_total

    if not medidas:
        raise SystemExit(f"No hubo ninguna respuesta. Códigos: {codigos}")

    p50, p95, p99 = percentil(medidas, 50), percentil(medidas, 95), percentil(medidas, 99)
    cumple = p95 <= 300

    print("-" * 64)
    print(f"  Respuestas medidas:   {len(medidas)}")
    print(f"  Reservas conseguidas: {codigos.get(201, 0)}")
    print(f"  Rechazos por ocupado: {codigos.get(409, 0)}")
    otros = {c: n for c, n in codigos.items() if c not in (201, 409)}
    if otros:
        print(f"  Otros códigos:        {otros}")
    print(f"  Duración total:       {duracion_total * 1000:.0f} ms")
    print(f"  Respuestas por seg.:  {len(medidas) / duracion_total:.1f}")
    print("-" * 64)
    print(f"  Mínimo:   {min(medidas):7.1f} ms")
    print(f"  Mediana:  {p50:7.1f} ms")
    print(f"  Promedio: {statistics.fmean(medidas):7.1f} ms")
    print(f"  p95:      {p95:7.1f} ms   <-- el que exige el RNF-02")
    print(f"  p99:      {p99:7.1f} ms")
    print(f"  Máximo:   {max(medidas):7.1f} ms")
    print("-" * 64)
    print(f"  RESULTADO: {'CUMPLE' if cumple else 'NO CUMPLE'} (p95 {p95:.1f} ms contra el límite de 300 ms)")

    if args.guardar:
        resumen = {
            "modo": modo,
            "llegada": f"{args.ritmo:.0f}/seg" if args.ritmo else "todos a la vez",
            "objetivo": "misma butaca" if args.mismo_asiento else "butacas distintas",
            "clientes": len(identidades),
            "respuestas": len(medidas),
            "reservas_ok": codigos.get(201, 0),
            "p50_ms": round(p50, 1),
            "p95_ms": round(p95, 1),
            "p99_ms": round(p99, 1),
            "max_ms": round(max(medidas), 1),
            "promedio_ms": round(statistics.fmean(medidas), 1),
            "respuestas_por_seg": round(len(medidas) / duracion_total, 1),
            "cumple_rnf02": cumple,
            "codigos": codigos,
        }
        destino = Path(args.guardar)
        destino.parent.mkdir(parents=True, exist_ok=True)
        destino.write_text(json.dumps(resumen, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n  Resultado guardado en {destino}")


if __name__ == "__main__":
    main()
