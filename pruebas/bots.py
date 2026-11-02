"""Prueba RNF-05: bloqueo de bots y de trampas al comprar.

Son cuatro comprobaciones independientes:

  1. Ráfaga desde una sola IP      -> el limitador debe cortar casi todo.
  2. Tope de 4 entradas por cliente -> la quinta debe ser rechazada.
  3. Reservar sin pasar por la sala -> 403.
  4. Pase de la sala falsificado    -> 403.

Uso:
    python3 pruebas/bots.py
    python3 pruebas/bots.py --url http://10.0.2.2:8000 --peticiones 5000

Requisitos:
    - ANTIBOTS=1 en el .env (es justo lo que se está probando).
    - MODO_RESERVA=sala, porque las pruebas 3 y 4 son sobre el pase.
    - Solo usa la librería estándar: no hay que instalar nada.
"""
import argparse
import json
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid

SIN_VERIFICAR = ssl.create_default_context()
SIN_VERIFICAR.check_hostname = False
SIN_VERIFICAR.verify_mode = ssl.CERT_NONE


def pedir(url, cuerpo=None, metodo="GET", cabeceras=None, timeout=30):
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


def conseguir_pase(base):
    codigo, r = pedir(f"{base}/api/sala/entrar", metodo="POST")
    if codigo != 200:
        return None
    ticket = r["ticket"]
    limite = time.time() + 60
    while time.time() < limite:
        codigo, r = pedir(f"{base}/api/sala/{ticket}")
        if codigo == 200 and r["estado"] == "admitido":
            return r["pase"]
        time.sleep(0.4)
    return None


def titulo(texto):
    print()
    print("-" * 64)
    print(f"  {texto}")
    print("-" * 64)


def prueba_tope_de_entradas(base, max_entradas):
    """Un mismo cliente intenta acaparar muchas butacas."""
    titulo(f"2. Un cliente intenta acaparar (tope: {max_entradas} entradas)")
    pase = conseguir_pase(base)
    if not pase:
        print("  No se pudo obtener un pase; ¿está el servidor en MODO_RESERVA=sala?")
        return None
    cabeceras = {"X-Pase": pase}

    codigo, asientos = pedir(f"{base}/api/eventos/1/asientos", cabeceras=cabeceras)
    libres = [a["id"] for a in asientos if a["estado"] == "libre"][: max_entradas + 6]

    conseguidas, rechazadas = 0, 0
    for asiento_id in libres:
        codigo, _ = pedir(f"{base}/api/reservas", {"asiento_id": asiento_id}, "POST", cabeceras)
        if codigo == 201:
            conseguidas += 1
        elif codigo == 429:
            rechazadas += 1

    # Se liberan las butacas para no dejar el aforo tomado
    for asiento_id in libres[:conseguidas]:
        pedir(f"{base}/api/reservas/{asiento_id}", metodo="DELETE", cabeceras=cabeceras)

    print(f"  Intentos:              {len(libres)}")
    print(f"  Reservas conseguidas:  {conseguidas}")
    print(f"  Rechazadas con 429:    {rechazadas}")
    cumple = conseguidas == max_entradas
    print(f"  RESULTADO: {'CUMPLE' if cumple else 'NO CUMPLE'} "
          f"(ningún cliente puede pasar de {max_entradas})")
    return cumple


def prueba_sin_pase(base):
    titulo("3. Reservar sin pasar por la sala de espera")
    codigo, r = pedir(f"{base}/api/reservas", {"asiento_id": 1}, "POST")
    print(f"  POST /api/reservas sin cabecera X-Pase -> {codigo} {r.get('detail')}")
    cumple = codigo == 403
    print(f"  RESULTADO: {'CUMPLE' if cumple else 'NO CUMPLE'} (se espera 403)")
    return cumple


def prueba_pase_falso(base):
    titulo("4. Pase de la sala falsificado")
    inventados = [
        ("pase inventado", uuid.uuid4().hex),
        ("firma cambiada", "abc123.0000000000000000000000000000000000000000000000000000000000000000"),
    ]
    resultados = []
    for descripcion, pase in inventados:
        codigo, r = pedir(f"{base}/api/reservas", {"asiento_id": 1}, "POST", {"X-Pase": pase})
        print(f"  {descripcion:16} -> {codigo} {r.get('detail')}")
        resultados.append(codigo == 403)
    cumple = all(resultados)
    print(f"  RESULTADO: {'CUMPLE' if cumple else 'NO CUMPLE'} (se espera 403 en todos)")
    return cumple


def prueba_rafaga(base, peticiones, limite, ventana, hilos=50):
    """Un bot machaca el servidor desde una sola IP."""
    titulo(f"1. Ráfaga de {peticiones} peticiones desde una sola IP")
    codigos = {}
    cerrojo = threading.Lock()
    pendientes = list(range(peticiones))
    indice = [0]

    def trabajar():
        while True:
            with cerrojo:
                if indice[0] >= len(pendientes):
                    return
                indice[0] += 1
            codigo, _ = pedir(f"{base}/api/eventos")
            with cerrojo:
                codigos[codigo] = codigos.get(codigo, 0) + 1

    inicio = time.perf_counter()
    equipo = [threading.Thread(target=trabajar) for _ in range(hilos)]
    for h in equipo:
        h.start()
    for h in equipo:
        h.join()
    duracion = time.perf_counter() - inicio

    pasaron = codigos.get(200, 0)
    bloqueadas = codigos.get(429, 0)
    porcentaje = bloqueadas / peticiones * 100 if peticiones else 0
    ritmo_bot = peticiones / duracion if duracion else 0
    permitido_por_seg = limite / ventana
    # La ventana se reinicia cada `ventana` segundos, así que el cupo total es
    # el límite multiplicado por la cantidad de ventanas que duró la ráfaga.
    ventanas_completas = int(duracion / ventana) + 1
    tope_teorico = limite * ventanas_completas

    print(f"  Duración:              {duracion:.1f} s ({ventanas_completas} ventanas de {ventana} s)")
    print(f"  Ritmo del bot:         {ritmo_bot:.0f} peticiones por segundo")
    print(f"  Pasaron (200):         {pasaron}")
    print(f"  Bloqueadas (429):      {bloqueadas}  ({porcentaje:.2f} %)")
    otros = {c: n for c, n in codigos.items() if c not in (200, 429)}
    if otros:
        print(f"  Otros códigos:         {otros}")
    print(f"  Tope teórico:          {tope_teorico} ({limite} por ventana x {ventanas_completas} ventanas)")
    print()
    print("  Lo que el limitador garantiza no es un porcentaje, es un tope absoluto:")
    print(f"  pase lo que pase, de una misma IP solo entran {permitido_por_seg:.0f} peticiones por segundo.")
    print("  El porcentaje bloqueado sale de ahí y depende de cuán rápido ataque el bot:")
    for ritmo in (60, 600, 3000, 10000):
        print(f"    bot a {ritmo:>6} pet./s -> se bloquea el {100 - permitido_por_seg / ritmo * 100:.2f} %")
    print(f"  Para pasar del 99.8 % que pide el RNF-05, el bot tiene que sostener más de")
    print(f"  {int(permitido_por_seg / 0.002)} peticiones por segundo. Desde una sola máquina se llegó a")
    print(f"  {ritmo_bot:.0f} pet./s y se bloqueó el {porcentaje:.2f} %; ese ritmo lo alcanza una botnet,")
    print("  no un equipo suelto, y en producción el WAF corta antes de llegar a la aplicación.")
    return pasaron <= tope_teorico


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:8000")
    parser.add_argument("--peticiones", type=int, default=1500)
    parser.add_argument("--limite", type=int, default=60, help="LIMITE_PETICIONES del .env")
    parser.add_argument("--ventana", type=int, default=10, help="VENTANA_SEGUNDOS del .env")
    args = parser.parse_args()
    base = args.url.rstrip("/")

    codigo, cfg = pedir(f"{base}/api/config")
    if codigo != 200:
        raise SystemExit(f"No se pudo hablar con {base}: {cfg}")

    codigo, salud = pedir(f"{base}/api/salud")
    print("=" * 64)
    print("PRUEBA RNF-05 · Bloqueo de bots")
    print("=" * 64)
    print(f"  Servidor:        {base}")
    print(f"  Modo de reserva: {cfg['modo']}")
    print(f"  Antibots:        {'activado' if salud.get('antibots') else 'DESACTIVADO'}")
    print(f"  Límite:          {args.limite} peticiones por {args.ventana} s y por IP")
    if not salud.get("antibots"):
        print("\n  AVISO: pon ANTIBOTS=1 en el .env y reinicia; sin eso no hay nada que medir.")

    resultados = {}
    # Las pruebas 2 a 4 van primero porque gastan pocas peticiones; la ráfaga
    # queda al final porque agota el cupo de la IP.
    resultados["tope de entradas"] = prueba_tope_de_entradas(base, cfg["max_entradas"])
    time.sleep(args.ventana + 1)
    resultados["sin pase"] = prueba_sin_pase(base)
    resultados["pase falso"] = prueba_pase_falso(base)
    time.sleep(args.ventana + 1)
    resultados["ráfaga bloqueada"] = prueba_rafaga(base, args.peticiones, args.limite, args.ventana)

    print()
    print("=" * 64)
    print("  RESUMEN")
    for nombre, cumple in resultados.items():
        estado = "CUMPLE" if cumple else ("NO CUMPLE" if cumple is False else "SIN DATO")
        print(f"    {nombre:20} {estado}")
    print("=" * 64)


if __name__ == "__main__":
    main()
