// Prueba de carga con k6 (RNF-01 y RNF-02).
//
// Cada usuario virtual hace el recorrido completo de un comprador: entra a la
// sala de espera, espera su turno, reserva una butaca y la libera. Lo que se
// mide es el tiempo de la reserva, que es lo que exige el RNF-02 (<= 300 ms).
//
// Uso, desde Ubuntu:
//     k6 run -e BASE=http://10.0.2.2:8000 pruebas/carga.js
//     k6 run -e BASE=http://10.0.2.2:8000 -e VUS=200 pruebas/carga.js
//     k6 run --out json=resultados/k6.json -e BASE=http://10.0.2.2:8000 pruebas/carga.js
//
// Requisitos:
//     - ANTIBOTS=0 en el .env, porque todas las peticiones salen de una IP.
//     - Aforo suficiente: scripts/iniciar_bd.py --reiniciar --filas 26 --por-fila 40
//
// Instalar k6 en Ubuntu 24.04:
//     sudo gpg -k
//     sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
//          --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
//     echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
//          | sudo tee /etc/apt/sources.list.d/k6.list
//     sudo apt update && sudo apt install k6

import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:8000";
const VUS = Number(__ENV.VUS || 100);
const EVENTO = Number(__ENV.EVENTO || 1);

// Métricas propias: el tiempo de la reserva se mira aparte del resto de las
// peticiones, porque es el único que el RNF-02 limita.
const reservaMs = new Trend("reserva_ms", true);
const salaMs = new Trend("sala_espera_ms", true);
const reservasOk = new Counter("reservas_ok");
const reservasConflicto = new Counter("reservas_conflicto");
const bloqueos = new Counter("bloqueos_429");

export const options = {
  scenarios: {
    compradores: {
      executor: "ramping-vus",
      startVUs: 5,
      stages: [
        { duration: "20s", target: Math.round(VUS / 2) },
        { duration: "40s", target: VUS },
        { duration: "30s", target: VUS },
        { duration: "15s", target: 0 },
      ],
      gracefulRampDown: "15s",
    },
  },
  thresholds: {
    // Este es el RNF-02: el 95 % de las reservas por debajo de 300 ms
    reserva_ms: ["p(95)<300"],
    // Y que el recorrido no se rompa por el camino
    checks: ["rate>0.98"],
  },
};

const json = { headers: { "Content-Type": "application/json" } };

export function setup() {
  const cfg = http.get(`${BASE}/api/config`);
  check(cfg, { "la API responde": (r) => r.status === 200 });
  if (cfg.status !== 200) fail(`No se pudo hablar con ${BASE}`);

  const resAsientos = http.get(`${BASE}/api/eventos/${EVENTO}/asientos`);
  if (resAsientos.status !== 200) {
    fail(`No se pudieron obtener asientos (${resAsientos.status}): ${resAsientos.body}`);
  }
  const asientos = resAsientos.json();
  if (!Array.isArray(asientos)) {
    fail(`Respuesta inesperada de asientos: ${resAsientos.body}`);
  }
  const libres = asientos.filter((a) => a.estado === "libre").map((a) => a.id);
  console.log(`modo=${cfg.json().modo}  asientos libres=${libres.length}`);
  if (libres.length < 50) {
    fail("Quedan muy pocos asientos libres. Reinicia la base con scripts/iniciar_bd.py --reiniciar");
  }
  return { modo: cfg.json().modo, libres };
}

// Devuelve las cabeceras que identifican a este comprador.
// En modo sala hay que pasar por la cola; en los otros basta un identificador.
function identificarse(modo) {
  if (modo !== "sala") {
    return { "Content-Type": "application/json", "X-Sesion": `k6-${__VU}-${__ITER}-${Date.now()}` };
  }

  const inicio = Date.now();
  const entrada = http.post(`${BASE}/api/sala/entrar`, null, json);
  if (entrada.status !== 200) {
    if (entrada.status === 429) bloqueos.add(1);
    return null;
  }
  const ticket = entrada.json().ticket;

  // Espera su turno. El tope de 60 vueltas evita quedarse colgado si el
  // servidor se cae en medio de la prueba.
  for (let vuelta = 0; vuelta < 60; vuelta++) {
    const estado = http.get(`${BASE}/api/sala/${ticket}`, json);
    if (estado.status === 200 && estado.json().estado === "admitido") {
      salaMs.add(Date.now() - inicio);
      return { "Content-Type": "application/json", "X-Pase": estado.json().pase };
    }
    sleep(0.5);
  }
  return null;
}

export default function (datos) {
  const cabeceras = identificarse(datos.modo);
  if (!cabeceras) {
    check(null, { "consiguió identificarse": () => false });
    return;
  }

  // Cada usuario virtual apunta a una butaca distinta, para medir el tiempo de
  // la reserva y no el de la pelea por una misma butaca (eso lo mide
  // pruebas/sobreventa.py y pruebas/latencia.py --mismo-asiento).
  const asiento = datos.libres[Math.floor(Math.random() * datos.libres.length)];

  const reserva = http.post(
    `${BASE}/api/reservas`,
    JSON.stringify({ asiento_id: asiento }),
    { headers: cabeceras, tags: { paso: "reserva" } },
  );

  check(reserva, {
    "la reserva respondió algo esperable": (r) => [201, 409, 429].includes(r.status),
  });

  if (reserva.status === 201) {
    reservaMs.add(reserva.timings.duration);
    reservasOk.add(1);
    // Se libera para que el aforo no se agote a mitad de la prueba
    http.del(`${BASE}/api/reservas/${asiento}`, null, { headers: cabeceras });
  } else if (reserva.status === 409) {
    reservasConflicto.add(1);
  } else if (reserva.status === 429) {
    bloqueos.add(1);
  }

  sleep(1);
}

export function handleSummary(datos) {
  const m = datos.metrics;
  const p95 = m.reserva_ms ? m.reserva_ms.values["p(95)"] : null;
  const linea = (t) => `  ${t}\n`;

  let salida = "\n" + "=".repeat(60) + "\n";
  salida += "  RESULTADO DE LA PRUEBA DE CARGA\n";
  salida += "=".repeat(60) + "\n";
  salida += linea(`Reservas conseguidas: ${m.reservas_ok ? m.reservas_ok.values.count : 0}`);
  salida += linea(`Conflictos (409):     ${m.reservas_conflicto ? m.reservas_conflicto.values.count : 0}`);
  salida += linea(`Bloqueos (429):       ${m.bloqueos_429 ? m.bloqueos_429.values.count : 0}`);
  if (p95 !== null) {
    salida += linea(`p95 de la reserva:    ${p95.toFixed(1)} ms  (límite del RNF-02: 300 ms)`);
    salida += linea(`RESULTADO: ${p95 < 300 ? "CUMPLE" : "NO CUMPLE"}`);
  }
  salida += "=".repeat(60) + "\n";

  return { stdout: salida };
}
