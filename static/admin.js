const $ = (id) => document.getElementById(id);

let clave = null;
let refresco = null;

// Nombres legibles para los contadores de /api/salud
const NOMBRES = {
  sala_llegadas: "Llegadas a la sala",
  reservas_ok: "Reservas conseguidas",
  reservas_rechazadas: "Reservas rechazadas (asiento tomado)",
  reservas_sobre_limite: "Reservas sobre el límite de 4",
  pagos_ok: "Pagos aprobados",
  pagos_rechazados: "Pagos rechazados por el banco",
  pagos_conflicto: "Pagos anulados por perder la reserva",
  bloqueos_antibots: "Peticiones bloqueadas por el limitador",
  errores_bd_saturada: "Errores por base de datos saturada",
  entradas_no_encontradas: "Consultas de entrada sin resultado",
  admin_clave_incorrecta: "Intentos con clave de admin incorrecta",
  validaciones_valida: "Entradas validadas en la puerta",
  validaciones_repetida: "Entradas repetidas rechazadas",
  validaciones_invalida: "QR inválidos o falsificados",
  validaciones_no_existe: "QR firmados sin orden asociada",
  segundos_activo: "Segundos encendido",
};

async function api(ruta, opciones = {}) {
  const resp = await fetch(ruta, {
    ...opciones,
    headers: { "Content-Type": "application/json", "X-Clave-Admin": clave, ...(opciones.headers || {}) },
  });
  let cuerpo = null;
  try { cuerpo = await resp.json(); } catch (e) { /* sin cuerpo */ }
  if (!resp.ok) {
    const error = new Error(typeof cuerpo?.detail === "string" ? cuerpo.detail : "Error inesperado");
    error.status = resp.status;
    throw error;
  }
  return cuerpo;
}

function escapar(texto) {
  const d = document.createElement("div");
  d.textContent = texto ?? "";
  return d.innerHTML;
}

const soles = (v) => "S/ " + v.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hora = (iso) => new Date(iso).toLocaleTimeString("es-PE");
const fechaCorta = (iso) => new Date(iso).toLocaleString("es-PE", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

// ---------------- indicadores ----------------

function indicador(etiqueta, valor, detalle) {
  return `
    <div class="indicador">
      <span class="etiqueta-indicador">${etiqueta}</span>
      <strong>${valor}</strong>
      <span class="detalle">${detalle}</span>
    </div>`;
}

function pintarIndicadores(r) {
  const ocupacion = r.aforo_total ? (r.asientos_vendidos / r.aforo_total) * 100 : 0;
  $("indicadores").innerHTML =
    indicador("Entradas vendidas", r.entradas_vendidas, `de ${r.aforo_total} asientos en cartelera`) +
    indicador("Ingresos", soles(r.ingresos), "cobrados por el proveedor") +
    indicador("Ocupación", ocupacion.toFixed(1) + " %", `${r.asientos_reservados} asientos reservados ahora`) +
    indicador("Entradas usadas", r.entradas_usadas, "validadas en la puerta");
}

// Barras de ocupación: una sola serie, así que un solo color y el valor
// escrito al final de cada barra. No hace falta leyenda.
function pintarOcupacion(eventos) {
  $("ocupacion").innerHTML = eventos.map((e) => `
    <div class="barra-evento">
      <div class="barra-titulo">
        <span>${escapar(e.nombre)}</span>
        <span class="detalle">${fechaCorta(e.fecha)} · ${soles(e.ingresos)}</span>
      </div>
      <div class="barra-pista">
        <div class="barra-valor" style="width: ${Math.max(e.ocupacion, 0.6)}%"></div>
      </div>
      <div class="barra-cifra">
        <strong>${e.ocupacion} %</strong>
        <span class="detalle">${e.vendidos} vendidos · ${e.reservados} reservados · ${e.aforo} asientos</span>
      </div>
    </div>`).join("");
}

function pintarOrdenes(ordenes) {
  if (ordenes.length === 0) {
    $("tabla-ordenes").innerHTML = '<caption class="nota">Todavía no hay compras registradas.</caption>';
    return;
  }
  $("tabla-ordenes").innerHTML = `
    <thead>
      <tr><th>Código</th><th>Evento</th><th>Asiento</th><th>Comprador</th>
          <th>Monto</th><th>Hora</th><th>Puerta</th></tr>
    </thead>
    <tbody>
      ${ordenes.map((o) => `
        <tr>
          <td class="mono">${o.codigo}</td>
          <td>${escapar(o.evento)}</td>
          <td>${o.asiento}</td>
          <td>${escapar(o.comprador)}</td>
          <td>${soles(o.monto)}</td>
          <td>${fechaCorta(o.creado_en)}</td>
          <td>${o.usado_en
            ? '<span class="insignia buena">usada</span>'
            : '<span class="insignia neutra">sin usar</span>'}</td>
        </tr>`).join("")}
    </tbody>`;
}

// ---------------- métricas en vivo ----------------

function pintarSalud(s) {
  $("estado-servidor").innerHTML = `
    <span class="insignia neutra">modo: ${s.modo}</span>
    <span class="insignia ${s.antibots ? "buena" : "aviso"}">antibots: ${s.antibots ? "activado" : "desactivado"}</span>
    <span class="insignia neutra">en cola: ${s.sala.en_cola}</span>
    <span class="insignia neutra">admitidos: ${s.sala.admitidos}</span>
    <span class="insignia neutra">${s.sala.admitidos_por_seg}/seg de admisión</span>`;

  const metricas = Object.entries(s.metricas).filter(([k]) => k !== "segundos_activo");
  $("contadores").innerHTML = metricas.length === 0
    ? '<p class="nota">Sin actividad todavía.</p>'
    : metricas.map(([k, v]) => `
        <div class="contador">
          <strong>${v.toLocaleString("es-PE")}</strong>
          <span class="detalle">${NOMBRES[k] || k}</span>
        </div>`).join("");
}

async function actualizar() {
  try {
    const [resumen, salud] = await Promise.all([api("/api/admin/resumen"), api("/api/salud")]);
    pintarIndicadores(resumen);
    pintarOcupacion(resumen.eventos);
    pintarOrdenes(resumen.ultimas_ordenes);
    pintarSalud(salud);
    $("actualizado").textContent = "Actualizado a las " + hora(new Date().toISOString()) +
      " · se refresca cada 3 segundos";
  } catch (e) {
    if (e.status === 401) return salir("La clave dejó de ser válida.");
    $("actualizado").textContent = "No se pudo actualizar: " + e.message;
  }
}

// ---------------- control de acceso ----------------

const TEXTO_ESTADO = {
  valida: ["buena", "ENTRADA VÁLIDA", "Puede ingresar."],
  repetida: ["aviso", "ENTRADA REPETIDA", "Este QR ya fue usado antes. No debe ingresar."],
  invalida: ["mala", "QR INVÁLIDO", "La firma no corresponde: el QR no lo emitimos nosotros."],
  no_existe: ["mala", "SIN ORDEN", "La firma es correcta pero no existe la compra."],
};

async function validar(evento) {
  evento.preventDefault();
  const contenido = new FormData(evento.target).get("contenido");
  const caja = $("resultado-validacion");
  caja.innerHTML = '<p class="nota">Comprobando…</p>';
  try {
    const r = await api("/api/admin/validar", { method: "POST", body: JSON.stringify({ contenido }) });
    const [clase, titulo, explicacion] = TEXTO_ESTADO[r.estado] || ["mala", r.estado, ""];
    caja.innerHTML = `
      <div class="resultado ${clase}">
        <strong>${titulo}</strong>
        <p>${explicacion}</p>
        ${r.entrada ? `
          <div class="ficha">
            <div><span class="clave">Evento</span><span>${escapar(r.entrada.evento)}</span></div>
            <div><span class="clave">Asiento</span><span>${r.entrada.asiento} (${r.entrada.zona})</span></div>
            <div><span class="clave">Titular</span><span>${escapar(r.entrada.comprador)}</span></div>
            <div><span class="clave">Código</span><span class="mono">${r.entrada.codigo}</span></div>
          </div>` : ""}
      </div>`;
    evento.target.reset();
    actualizar();
  } catch (e) {
    if (e.status === 401) return salir("La clave dejó de ser válida.");
    caja.innerHTML = `<div class="resultado mala"><strong>Error</strong><p>${escapar(e.message)}</p></div>`;
  }
}

// ---------------- acceso ----------------

async function entrar(evento) {
  evento.preventDefault();
  clave = new FormData(evento.target).get("clave");
  $("mensaje-clave").textContent = "Comprobando…";
  try {
    await api("/api/admin/resumen");
  } catch (e) {
    clave = null;
    $("mensaje-clave").textContent = e.message;
    $("mensaje-clave").className = "mensaje error";
    return;
  }
  try { sessionStorage.setItem("clave_admin", clave); } catch (e) { /* nada */ }
  abrirPanel();
}

function abrirPanel() {
  $("vista-clave").hidden = true;
  $("vista-panel").hidden = false;
  $("mensaje-clave").textContent = "";
  actualizar();
  refresco = setInterval(actualizar, 3000);
}

function salir(aviso = "") {
  clearInterval(refresco);
  refresco = null;
  clave = null;
  try { sessionStorage.removeItem("clave_admin"); } catch (e) { /* nada */ }
  $("vista-panel").hidden = true;
  $("vista-clave").hidden = false;
  $("mensaje-clave").textContent = aviso;
  $("mensaje-clave").className = "mensaje" + (aviso ? " error" : "");
}

async function reiniciarContadores() {
  await fetch("/api/metricas/reiniciar", { method: "POST" });
  actualizar();
}

$("form-clave").addEventListener("submit", entrar);
$("form-validar").addEventListener("submit", validar);
$("btn-salir").addEventListener("click", () => salir());
$("btn-reiniciar").addEventListener("click", reiniciarContadores);

// Si la clave ya se usó en esta pestaña, no la vuelve a pedir
(function iniciar() {
  try { clave = sessionStorage.getItem("clave_admin"); } catch (e) { clave = null; }
  if (clave) abrirPanel();
  else salir();
})();
