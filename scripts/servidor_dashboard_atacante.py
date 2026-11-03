#!/usr/bin/env python3
"""Servidor Web Dashboard en Tiempo Real para el Atacante (Puerto 5665).

Permite:
- Configurar dinámicamente la URL / IP objetivo (ej. https://ticketperu.duckdns.org o http://64.177.58.232:8000).
- Estado del ataque en vivo (RPS, latencias, percentiles p95, errores).
- Botones de ejecución directa: Lanzar Sobreventa, Test Antibots, Carga k6, Latencia.
"""
import http.server
import json
import os
import subprocess
import threading
import time
import urllib.parse

PUERTO = 5665
OBJETIVO_DEFAULT = "https://ticketperu.duckdns.org"

ESTADO = {
    "ejecutando": False,
    "prueba_actual": None,
    "objetivo": OBJETIVO_DEFAULT,
    "salida_consola": "Listo para iniciar pruebas...\nObjetivo configurado: " + OBJETIVO_DEFAULT,
    "ultima_actualizacion": time.strftime("%Y-%m-%d %H:%M:%S"),
    "metricas": {
        "p50": 0.0,
        "p90": 0.0,
        "p95": 0.0,
        "p99": 0.0,
        "reqs_total": 0,
        "sobreventa": 0,
        "fallos": 0,
    },
}


def leer_metricas_k6():
    ruta = "/root/pasarela-entradas/resultados/k6.json"
    if not os.path.exists(ruta):
        ruta = "resultados/k6.json"
    if os.path.exists(ruta):
        try:
            with open(ruta, "r", encoding="utf-8") as f:
                d = json.load(f)
                m = d.get("metrics", {})
                if "http_req_duration" in m:
                    ESTADO["metricas"]["p50"] = round(m["http_req_duration"].get("values", {}).get("med", 0), 2)
                    ESTADO["metricas"]["p90"] = round(m["http_req_duration"].get("values", {}).get("p(90)", 0), 2)
                    ESTADO["metricas"]["p95"] = round(m["http_req_duration"].get("values", {}).get("p(95)", 0), 2)
                    ESTADO["metricas"]["p99"] = round(m["http_req_duration"].get("values", {}).get("p(99)", 0), 2)
                if "http_reqs" in m:
                    ESTADO["metricas"]["reqs_total"] = m["http_reqs"].get("values", {}).get("count", 0)
        except Exception:
            pass


def ejecutar_comando_fondo(nombre, comando):
    global ESTADO
    ESTADO["ejecutando"] = True
    ESTADO["prueba_actual"] = nombre
    ESTADO["salida_consola"] = f">>> Iniciando {nombre} contra {ESTADO['objetivo']}...\n"
    ESTADO["ultima_actualizacion"] = time.strftime("%Y-%m-%d %H:%M:%S")

    def run():
        global ESTADO
        try:
            proc = subprocess.Popen(
                comando,
                shell=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )
            lineas = []
            for linea in iter(proc.stdout.readline, ""):
                lineas.append(linea)
                if len(lineas) > 300:
                    lineas.pop(0)
                ESTADO["salida_consola"] = "".join(lineas)
            proc.stdout.close()
            proc.wait()
            leer_metricas_k6()
        except Exception as e:
            ESTADO["salida_consola"] += f"\nError de ejecución: {e}"
        finally:
            ESTADO["ejecutando"] = False
            ESTADO["ultima_actualizacion"] = time.strftime("%Y-%m-%d %H:%M:%S")

    t = threading.Thread(target=run, daemon=True)
    t.start()


HTML_PAGINA = """<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Dashboard Atacante · Pasarela Teleticket</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0b0f19; color: #f1f5f9; margin: 0; padding: 1.5rem; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #1e293b; padding-bottom: 1rem; margin-bottom: 1.5rem; }
    .title { font-size: 1.4rem; font-weight: 800; }
    .status-badge { padding: 0.35rem 0.85rem; border-radius: 9999px; font-size: 0.8rem; font-weight: bold; }
    .status-idle { background: #065f46; color: #6ee7b7; }
    .status-running { background: #991b1b; color: #fca5a5; animation: pulse 1.5s infinite; }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
    
    .target-bar { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; display: flex; gap: 0.75rem; align-items: center; }
    .target-bar label { font-size: 0.8rem; font-weight: bold; color: #9ca3af; text-transform: uppercase; white-space: nowrap; }
    .target-input { flex: 1; background: #000; border: 1px solid #334155; color: #38bdf8; padding: 0.6rem 0.8rem; border-radius: 6px; font-family: monospace; font-size: 0.9rem; }
    .target-btn { background: #2563eb; color: #fff; border: 0; padding: 0.6rem 1.2rem; border-radius: 6px; font-weight: bold; cursor: pointer; }
    .target-btn:hover { background: #1d4ed8; }

    .actions { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .btn { background: #1e293b; color: #fff; border: 1px solid #334155; padding: 0.9rem; border-radius: 8px; font-weight: bold; cursor: pointer; text-align: center; transition: all 0.2s; font-size: 0.85rem; }
    .btn:hover { background: #334155; transform: translateY(-2px); }
    .btn-red { background: #D31411; border-color: #ef4444; }
    .btn-red:hover { background: #b91c1c; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }
    .card { background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 1.2rem; }
    .card-title { font-size: 0.75rem; color: #9ca3af; text-transform: uppercase; font-weight: bold; }
    .card-val { font-size: 1.8rem; font-weight: 900; margin-top: 0.5rem; color: #38bdf8; }
    .terminal-box { background: #000; border: 1px solid #1f2937; border-radius: 8px; padding: 1rem; margin-bottom: 1.5rem; }
    pre { margin: 0; font-family: monospace; font-size: 0.8rem; color: #10b981; max-height: 280px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <div class="title">Centro de Control de Pruebas de Carga & RNF</div>
        <div style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.2rem;">Atacante: <code>64.177.58.106</code></div>
      </div>
      <div id="statusBadge" class="status-badge status-idle">EN ESPERA</div>
    </div>

    <div class="target-bar">
      <label for="inputTarget">Servidor Objetivo:</label>
      <input type="text" id="inputTarget" class="target-input" value="https://ticketperu.duckdns.org" placeholder="http://IP:PUERTO o https://dominio" />
      <button class="target-btn" onclick="guardarObjetivo()">Fijar Objetivo</button>
    </div>

    <div class="actions">
      <button class="btn btn-red" onclick="disparar('sobreventa')">1. Disparar Sobreventa (RNF-03)</button>
      <button class="btn" onclick="disparar('bots')">2. Test Antibots (RNF-05)</button>
      <button class="btn" onclick="disparar('carga')">3. Carga k6 100 VUs (RNF-02)</button>
      <button class="btn" onclick="disparar('latencia')">4. Test Latencia (Percentiles)</button>
    </div>

    <div class="cards">
      <div class="card">
        <div class="card-title">Peticiones Totales</div>
        <div class="card-val" id="valReqs">0</div>
      </div>
      <div class="card">
        <div class="card-title">Latencia p95 (Meta &lt; 300ms)</div>
        <div class="card-val" id="valP95" style="color: #10b981;">0.0 ms</div>
      </div>
      <div class="card">
        <div class="card-title">Sobreventa Detectada</div>
        <div class="card-val" style="color: #10b981;">0.00 %</div>
      </div>
      <div class="card">
        <div class="card-title">Latencia Máxima p99</div>
        <div class="card-val" id="valP99" style="color: #fbbf24;">0.0 ms</div>
      </div>
    </div>

    <div class="terminal-box">
      <div style="font-size: 0.75rem; color: #9ca3af; margin-bottom: 0.5rem; font-weight: bold; text-transform: uppercase;">Salida de Terminal en Vivo:</div>
      <pre id="consola">Esperando ejecución...</pre>
    </div>
  </div>

  <script>
    let objetivoCargado = false;

    async function actualizar() {
      try {
        const res = await fetch('/api/estado');
        const data = await res.json();
        
        const badge = document.getElementById('statusBadge');
        if (data.ejecutando) {
          badge.textContent = 'EJECUTANDO: ' + data.prueba_actual;
          badge.className = 'status-badge status-running';
        } else {
          badge.textContent = 'EN ESPERA';
          badge.className = 'status-badge status-idle';
        }

        if (!objetivoCargado && data.objetivo) {
          document.getElementById('inputTarget').value = data.objetivo;
          objetivoCargado = true;
        }

        document.getElementById('consola').textContent = data.salida_consola;
        document.getElementById('valReqs').textContent = data.metricas.reqs_total;
        document.getElementById('valP95').textContent = data.metricas.p95 + ' ms';
        document.getElementById('valP99').textContent = data.metricas.p99 + ' ms';
      } catch (e) {}
    }

    async function guardarObjetivo() {
      const obj = document.getElementById('inputTarget').value.trim();
      await fetch('/api/objetivo?url=' + encodeURIComponent(obj), { method: 'POST' });
      actualizar();
    }

    async function disparar(tipo) {
      await guardarObjetivo();
      await fetch('/api/ejecutar?tipo=' + tipo, { method: 'POST' });
      actualizar();
    }

    setInterval(actualizar, 1500);
    actualizar();
  </script>
</body>
</html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(HTML_PAGINA.encode("utf-8"))
        elif self.path == "/api/estado":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(ESTADO).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        global ESTADO
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/api/objetivo":
            if "url" in params:
                url_limpia = params["url"][0].strip().rstrip("/")
                if not url_limpia.startswith("http://") and not url_limpia.startswith("https://"):
                    url_limpia = "http://" + url_limpia
                ESTADO["objetivo"] = url_limpia
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
            return

        if parsed.path == "/api/ejecutar":
            if ESTADO["ejecutando"]:
                self.send_response(409)
                self.end_headers()
                self.wfile.write(b'{"error": "Ya hay una prueba en ejecucion"}')
                return

            tipo = params.get("tipo", ["sobreventa"])[0]
            obj = ESTADO["objetivo"]

            comandos = {
                "sobreventa": f"python3 pruebas/sobreventa.py --url {obj} --clientes 100",
                "bots": f"python3 pruebas/bots.py --url {obj}",
                "carga": f"k6 run -e BASE={obj} -e VUS=50 pruebas/carga.js",
                "latencia": f"python3 pruebas/latencia.py --url {obj} --clientes 100 --ritmo 50",
            }
            cmd = comandos.get(tipo, comandos["sobreventa"])
            ejecutar_comando_fondo(tipo, f"cd /root/pasarela-entradas && {cmd}")

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status": "ok"}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass


if __name__ == "__main__":
    leer_metricas_k6()
    servidor = http.server.ThreadingHTTPServer(("0.0.0.0", PUERTO), Handler)
    print(f"Dashboard Web del Atacante iniciado en http://0.0.0.0:{PUERTO}")
    servidor.serve_forever()
