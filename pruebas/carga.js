// Prueba de carga con k6 (RNF-01 y RNF-02).
import http from "k6/http";
import { check, sleep, fail } from "k6";
import { Trend, Counter } from "k6/metrics";

const BASE = __ENV.BASE || "http://127.0.0.1:8000";
const VUS = Number(__ENV.VUS || 100);
const EVENTO = Number(__ENV.EVENTO || 1);

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
    reserva_ms: ["p(95)<300"],
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
  if (libres.length < VUS) {
    fail(`Aforo insuficiente para ${VUS} VUs: solo hay ${libres.length} asientos libres.`);
  }

  return { modo: cfg.json().modo, asientosLibres: libres };
}

function pasarSalaEspera() {
  const t0 = Date.now();
  const rEntrar = http.post(`${BASE}/api/sala/entrar`, null, json);
  if (rEntrar.status !== 200) {
    if (rEntrar.status === 429) bloqueos.add(1);
    return null;
  }
  const ticket = rEntrar.json().ticket;

  for (let intento = 0; intento < 60; intento++) {
    sleep(0.5);
    const rEstado = http.get(`${BASE}/api/sala/${ticket}`);
    if (rEstado.status === 200 && rEstado.json().estado === "admitido") {
      salaMs.add(Date.now() - t0);
      return rEstado.json().pase;
    }
  }
  return null;
}

export default function (data) {
  let pase = null;
  if (data.modo === "sala") {
    pase = pasarSalaEspera();
    if (!pase) return;
  }

  const cabeceras = { "Content-Type": "application/json" };
  if (data.modo === "sala") {
    cabeceras["X-Pase"] = pase;
  } else {
    cabeceras["X-Sesion"] = `vu-${__VU}-${__ITER}`;
  }

  const idx = (__VU * 1000 + __ITER) % data.asientosLibres.length;
  const asiento = data.asientosLibres[idx];

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

  return {
    stdout: salida,
    "resultados/k6.json": JSON.stringify(datos, null, 2),
  };
}
