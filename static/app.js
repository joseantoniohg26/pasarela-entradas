const estado = {
  modo: null,
  pase: null,
  sesion: null,
  eventos: [],
  evento: null,
  asientos: [],
  reserva: null,        // { id, etiqueta, precio, hasta }
  temporizador: null,   // cuenta atrás de la reserva
  refresco: null,       // recarga periódica del mapa
};

const $ = (id) => document.getElementById(id);

function guardar(clave, valor) {
  try { sessionStorage.setItem(clave, valor); } catch (e) { /* modo privado */ }
}
function leer(clave) {
  try { return sessionStorage.getItem(clave); } catch (e) { return null; }
}
function borrar(clave) {
  try { sessionStorage.removeItem(clave); } catch (e) { /* nada */ }
}

function cabeceras() {
  const h = { "Content-Type": "application/json" };
  if (estado.modo === "sala") h["X-Pase"] = estado.pase;
  else h["X-Sesion"] = estado.sesion;
  return h;
}

async function api(ruta, opciones = {}) {
  const resp = await fetch(ruta, { ...opciones, headers: { ...cabeceras(), ...(opciones.headers || {}) } });
  let cuerpo = null;
  try { cuerpo = await resp.json(); } catch (e) { /* sin cuerpo */ }
  if (!resp.ok) {
    const detalle = typeof cuerpo?.detail === "string" ? cuerpo.detail : "Ocurrió un error, intenta de nuevo";
    const error = new Error(detalle);
    error.status = resp.status;
    throw error;
  }
  return cuerpo;
}

function mensaje(texto, tipo = "") {
  const m = $("mensaje");
  m.textContent = texto;
  m.className = "mensaje " + tipo;
}

function mostrar(vista) {
  for (const v of ["catalogo", "detalle", "entradas", "sala", "mapa"]) {
    $("vista-" + v).hidden = v !== vista;
  }
  window.scrollTo(0, 0);
}

function mostrarPanel(panel) {
  for (const p of ["vacio", "reserva", "ok"]) $("panel-" + p).hidden = p !== panel;
}

// ---------------- formato y utilidades ----------------

function fechaLarga(iso) {
  return new Date(iso).toLocaleString("es-PE", { dateStyle: "full", timeStyle: "short" });
}

function fechaCorta(iso) {
  return new Date(iso).toLocaleString("es-PE", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function soles(valor) {
  return "S/ " + valor.toFixed(2);
}

function afiche(evento) {
  // Comillas simples: este valor se inserta dentro de un atributo style="..."
  return evento.imagen ? `url('img/${evento.imagen}')` : "none";
}

// El texto viene de la base de datos y se inserta como HTML, así que se
// escapa primero para que nadie pueda inyectar etiquetas.
function escapar(texto) {
  const d = document.createElement("div");
  d.textContent = texto ?? "";
  return d.innerHTML;
}

function nombreZona(precio) {
  if (precio >= 300) return "VIP";
  if (precio >= 200) return "Preferencial";
  return "General";
}

function zona(precio) {
  if (precio >= 300) return "vip";
  if (precio >= 200) return "pref";
  return "gen";
}

// Las compras de este navegador se guardan en localStorage: solo el código y
// el correo, que es lo que el servidor pide para devolver la entrada.
function compras() {
  try { return JSON.parse(localStorage.getItem("compras") || "[]"); } catch (e) { return []; }
}

function anotarCompra(codigo, email) {
  const lista = compras().filter((c) => c.codigo !== codigo);
  lista.unshift({ codigo, email });
  try { localStorage.setItem("compras", JSON.stringify(lista.slice(0, 20))); } catch (e) { /* nada */ }
}

// ---------------- 1. catálogo ----------------

function tarjetaEvento(ev) {
  const agotado = ev.disponibles === 0;
  return `
    <a class="tarjeta-evento" href="#/evento/${ev.id}">
      <div class="afiche" style="background-image: ${afiche(ev)}">
        <span class="etiqueta">${escapar(ev.categoria)}</span>
        ${agotado ? '<div class="agotado">AGOTADO</div>' : ""}
      </div>
      <div class="datos-evento">
        <p class="fecha">${fechaCorta(ev.fecha)}</p>
        <h3>${escapar(ev.nombre)}</h3>
        <p class="lugar">${escapar(ev.lugar)}</p>
        <p class="desde">Desde <strong>${ev.precio_desde === null ? "–" : soles(ev.precio_desde)}</strong></p>
      </div>
    </a>`;
}

async function mostrarCatalogo() {
  estado.eventos = await api("/api/eventos");
  const destacado = estado.eventos[0];

  $("destacado").style.backgroundImage = afiche(destacado);
  $("dest-categoria").textContent = destacado.categoria;
  $("dest-nombre").textContent = destacado.nombre;
  $("dest-artista").textContent = destacado.artista;
  $("dest-datos").textContent = `${destacado.lugar} · ${fechaLarga(destacado.fecha)}`;
  $("dest-comprar").href = "#/comprar/" + destacado.id;
  $("dest-detalle").href = "#/evento/" + destacado.id;

  $("rejilla").innerHTML = estado.eventos.map(tarjetaEvento).join("");
  mostrar("catalogo");
}

// ---------------- 2. detalle del evento ----------------

async function mostrarDetalle(id) {
  const ev = await api("/api/eventos/" + id);
  const agotado = ev.disponibles === 0;
  const vendidas = ev.aforo - ev.disponibles;

  $("vista-detalle").innerHTML = `
    <nav class="migas">
      <a href="#/">Cartelera</a>
      <span class="actual">${escapar(ev.nombre)}</span>
    </nav>

    <div class="detalle-portada" style="background-image: ${afiche(ev)}">
      <div>
        <span class="etiqueta">${escapar(ev.categoria)}</span>
        <h1>${escapar(ev.nombre)}</h1>
        <p class="artista">${escapar(ev.artista)}</p>
      </div>
    </div>

    <div class="detalle-cuerpo">
      <div>
        <h2>Sobre el evento</h2>
        <p>${escapar(ev.descripcion)}</p>

        <div class="ficha">
          <div><span class="clave">Fecha</span><span>${fechaLarga(ev.fecha)}</span></div>
          <div><span class="clave">Lugar</span><span>${escapar(ev.lugar)}</span></div>
          <div><span class="clave">Aforo</span><span>${ev.aforo} asientos · ${vendidas} vendidos</span></div>
          <div><span class="clave">Límite</span><span>Máximo 4 entradas por persona</span></div>
        </div>
      </div>

      <aside class="tarjeta">
        <h2>Zonas y precios</h2>
        <ul class="zonas">
          ${ev.zonas.map((z) => `
            <li>
              <i class="z-${zona(z.precio)}"></i>
              <span>${nombreZona(z.precio)}<small>${z.disponibles} de ${z.total} disponibles</small></span>
              <span class="precio-zona">${soles(z.precio)}</span>
            </li>`).join("")}
        </ul>
        ${agotado
          ? '<p class="nota">No quedan entradas para este evento.</p>'
          : `<a class="boton" style="width: 100%" href="#/comprar/${ev.id}">Comprar entradas</a>
             <p class="ayuda" style="margin-top: 12px">Si hay mucha demanda pasarás primero por la sala de espera.</p>`}
      </aside>
    </div>`;

  mostrar("detalle");
}

// ---------------- 3. sala de espera ----------------

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function pasarPorSala() {
  let ticket = leer("ticket");
  let posicionInicial = Number(leer("posicion_inicial")) || 1;

  if (!ticket) {
    const r = await api("/api/sala/entrar", { method: "POST" });
    ticket = r.ticket;
    posicionInicial = Math.max(1, r.posicion);
    guardar("ticket", ticket);
    guardar("posicion_inicial", posicionInicial);
  }

  mostrar("sala");
  while (true) {
    let r;
    try {
      r = await api("/api/sala/" + ticket);
    } catch (e) {
      if (e.status === 404) {          // el servidor se reinició: volver a entrar
        borrar("ticket");
        return pasarPorSala();
      }
      await esperar(3000);
      continue;
    }
    if (r.estado === "admitido") {
      estado.pase = r.pase;
      guardar("pase", r.pase);
      borrar("ticket");
      return;
    }
    $("sala-posicion").textContent = r.posicion.toLocaleString("es-PE");
    const avance = 1 - r.posicion / posicionInicial;
    $("sala-barra").style.width = Math.max(4, avance * 100) + "%";
    await esperar(1500);
  }
}

function reiniciarPase() {
  borrar("pase");
  estado.pase = null;
  mensaje("Tu pase venció. Vuelve a la sala de espera…", "error");
  setTimeout(() => location.reload(), 1500);
}

// ---------------- 4. mapa de asientos y pago ----------------

function dibujarAsientos() {
  const cont = $("asientos");
  cont.innerHTML = "";
  const porFila = new Map();
  for (const a of estado.asientos) {
    if (!porFila.has(a.fila)) porFila.set(a.fila, []);
    porFila.get(a.fila).push(a);
  }
  for (const [letra, lista] of porFila) {
    const fila = document.createElement("div");
    fila.className = "fila";
    fila.innerHTML = `<span class="letra">${letra}</span>`;
    for (const a of lista) {
      const b = document.createElement("button");
      let clase = "asiento " + zona(a.precio);
      if (a.mio) clase += " mio";
      else if (a.estado !== "libre") clase += " ocupado";
      else if (estado.reserva) clase += " en-pausa";   // primero termina tu compra actual
      b.className = clase;
      b.textContent = a.numero;
      b.title = `Fila ${a.fila}, asiento ${a.numero} · ${soles(a.precio)}`;
      b.disabled = a.mio || a.estado !== "libre" || estado.reserva !== null;
      b.addEventListener("click", () => reservar(a));
      fila.appendChild(b);
    }
    fila.insertAdjacentHTML("beforeend", `<span class="letra">${letra}</span>`);
    cont.appendChild(fila);
  }
}

async function cargarAsientos() {
  try {
    estado.asientos = await api(`/api/eventos/${estado.evento.id}/asientos`);
    const mio = estado.asientos.find((a) => a.mio);
    if (mio && !estado.reserva) {     // p. ej. después de recargar la página
      estado.reserva = {
        id: mio.id, etiqueta: `${mio.fila}-${mio.numero}`,
        precio: mio.precio, hasta: new Date(mio.reservado_hasta),
      };
      abrirPanelReserva();
    }
    dibujarAsientos();
  } catch (e) {
    if (e.status === 429) mensaje(e.message, "error");
  }
}

async function reservar(asiento) {
  mensaje("Apartando asiento…");
  try {
    const r = await api("/api/reservas", {
      method: "POST",
      body: JSON.stringify({ asiento_id: asiento.id }),
    });
    estado.reserva = {
      id: asiento.id,
      etiqueta: `${asiento.fila}-${asiento.numero}`,
      precio: asiento.precio,
      hasta: new Date(r.reservado_hasta),
    };
    mensaje("");
    abrirPanelReserva();
  } catch (e) {
    if (e.status === 403) return reiniciarPase();
    mensaje(e.message, "error");
  }
  cargarAsientos();
}

function abrirPanelReserva() {
  const r = estado.reserva;
  $("res-asiento").textContent = r.etiqueta;
  $("res-precio").textContent = r.precio.toFixed(2);
  mostrarPanel("reserva");
  clearInterval(estado.temporizador);
  const tic = () => {
    const resta = Math.max(0, Math.round((r.hasta - Date.now()) / 1000));
    $("res-reloj").textContent =
      String(Math.floor(resta / 60)).padStart(2, "0") + ":" + String(resta % 60).padStart(2, "0");
    if (resta === 0) {
      clearInterval(estado.temporizador);
      estado.reserva = null;
      mostrarPanel("vacio");
      mensaje("Se acabó el tiempo y el asiento fue liberado.", "error");
      cargarAsientos();
    }
  };
  tic();
  estado.temporizador = setInterval(tic, 1000);
}

async function cancelar() {
  if (!estado.reserva) return;
  try {
    await api("/api/reservas/" + estado.reserva.id, { method: "DELETE" });
  } catch (e) { /* si ya expiró no importa */ }
  clearInterval(estado.temporizador);
  estado.reserva = null;
  mostrarPanel("vacio");
  mensaje("Reserva cancelada.");
  cargarAsientos();
}

async function pagar(evento) {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(evento.target));
  const boton = $("btn-pagar");
  boton.disabled = true;
  mensaje("Procesando pago seguro…");
  try {
    let tokenPago = "";
    // ISO 25010 - Seguridad (PCI-DSS): Tokenización directa en Culqi sin tocar el backend propio
    if (estado.cfg?.proveedor_pago === "culqi" && estado.cfg?.culqi_public_key) {
      const partesVence = (datos.vencimiento || "").split("/");
      const mes = partesVence[0]?.trim();
      let anio = partesVence[1]?.trim() || "";
      if (anio.length === 2) anio = "20" + anio;
      const numLimpio = (datos.numero || "").replace(/\s+/g, "");

      const respCulqi = await fetch("https://api.culqi.com/v2/tokens", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + estado.cfg.culqi_public_key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          card_number: numLimpio,
          cvv: (datos.cvv || "").trim(),
          expiration_month: mes,
          expiration_year: anio,
          email: datos.email.trim(),
        }),
      });

      const jsonCulqi = await respCulqi.json();
      if (!respCulqi.ok || !jsonCulqi.id) {
        throw new Error(jsonCulqi.user_message || jsonCulqi.merchant_message || "La tarjeta fue rechazada por Culqi");
      }
      tokenPago = jsonCulqi.id;
    } else {
      // 1. En modo simulador local, el navegador tokeniza con la pasarela simulada
      const tok = await api("/simulador-pasarela/tokenizar", {
        method: "POST",
        body: JSON.stringify({
          numero: datos.numero, vencimiento: datos.vencimiento,
          cvv: datos.cvv, titular: datos.comprador,
        }),
      });
      tokenPago = tok.token;
    }

    // 2. A nuestro backend solo le llega el token (cero almacenamiento de tarjeta)
    const orden = await api("/api/pagos", {
      method: "POST",
      body: JSON.stringify({
        asiento_id: estado.reserva.id, comprador: datos.comprador,
        email: datos.email, token_pago: tokenPago,
      }),
    });
    clearInterval(estado.temporizador);
    anotarCompra(orden.codigo, datos.email);
    $("ok-codigo").textContent = orden.codigo;
    $("ok-detalle").textContent =
      `Asiento ${estado.reserva.etiqueta} · ${soles(orden.monto)} · tarjeta •••• ${orden.tarjeta_ultimos4 || orden.tarjeta || ""}`;
    estado.reserva = null;
    evento.target.reset();
    mostrarPanel("ok");
    mensaje("");
    cargarAsientos();
  } catch (e) {
    if (e.status === 403) return reiniciarPase();
    mensaje(e.message, "error");
    if (e.status === 409) {
      clearInterval(estado.temporizador);
      estado.reserva = null;
      mostrarPanel("vacio");
      cargarAsientos();
    }
  } finally {
    boton.disabled = false;
  }
}

async function iniciarCompra(id, viaje) {
  estado.evento = await api("/api/eventos/" + id);

  // La sala de espera protege solo la compra: la cartelera se puede ver sin pase.
  if (estado.modo === "sala" && !estado.pase) await pasarPorSala();

  // Esperar en la sala toma tiempo; si mientras tanto el usuario se fue a otra
  // pantalla, no lo traemos de vuelta al mapa.
  if (viaje !== viajeActual) return;

  $("miga-evento").textContent = estado.evento.nombre;
  mostrarPanel("vacio");
  mensaje("");
  mostrar("mapa");
  await cargarAsientos();
  estado.refresco = setInterval(cargarAsientos, 5000);
}

// ---------------- 3. mis entradas ----------------

function mensajeEntradas(texto, tipo = "") {
  const m = $("mensaje-entradas");
  m.textContent = texto;
  m.className = "mensaje " + tipo;
}

function tarjetaEntrada(e) {
  const usada = e.usado_en !== null;
  return `
    <article class="entrada ${usada ? "usada" : ""}">
      <div class="entrada-datos">
        <span class="etiqueta">${e.zona}</span>
        <h3>${escapar(e.evento)}</h3>
        <p class="lugar">${escapar(e.lugar)} · ${fechaLarga(e.fecha)}</p>
        <div class="ficha">
          <div><span class="clave">Asiento</span><span>${e.asiento}</span></div>
          <div><span class="clave">A nombre de</span><span>${escapar(e.comprador)}</span></div>
          <div><span class="clave">Pagado</span><span>${soles(e.monto)} · tarjeta •••• ${e.tarjeta_ultimos4}</span></div>
          <div><span class="clave">Código</span><span class="codigo-chico">${e.codigo}</span></div>
        </div>
      </div>
      <div class="entrada-qr">
        ${e.qr}
        <p class="ayuda">${usada ? "Entrada ya utilizada el " + fechaCorta(e.usado_en) : "Presenta este QR en la puerta"}</p>
        <details class="contenido-qr">
          <summary>Ver lo que dice el QR</summary>
          <p class="qr-texto">${escapar(e.qr_texto)}</p>
          <button type="button" class="copiar" data-texto="${escapar(e.qr_texto)}">Copiar</button>
        </details>
      </div>
    </article>`;
}

async function mostrarEntradas() {
  mostrar("entradas");
  const guardadas = compras();
  const cont = $("lista-entradas");

  if (guardadas.length === 0) {
    cont.innerHTML = `
      <p class="nota">Todavía no has comprado nada en este navegador.
      Si compraste en otro, busca tu entrada con el código y el correo.</p>`;
    return;
  }

  cont.innerHTML = '<p class="nota">Cargando tus entradas…</p>';
  const encontradas = [];
  for (const c of guardadas) {
    try {
      encontradas.push(await api(`/api/entradas/${c.codigo}?email=${encodeURIComponent(c.email)}`));
    } catch (e) { /* una compra de otra base de datos; se ignora */ }
  }
  cont.innerHTML = encontradas.length
    ? encontradas.map(tarjetaEntrada).join("")
    : '<p class="nota">No pudimos recuperar tus entradas. Búscalas con el código y el correo.</p>';
}

// En la exposición no hay un escáner de verdad, así que el contenido del QR se
// copia desde aquí y se pega en el panel de administración.
async function copiarTexto(boton) {
  const texto = boton.dataset.texto;
  try {
    await navigator.clipboard.writeText(texto);
    boton.textContent = "Copiado";
  } catch (e) {
    // navigator.clipboard no existe sin https; se selecciona para copiar a mano
    const campo = document.createElement("textarea");
    campo.value = texto;
    document.body.appendChild(campo);
    campo.select();
    const salio = document.execCommand && document.execCommand("copy");
    campo.remove();
    boton.textContent = salio ? "Copiado" : "Selecciónalo y copia con Ctrl+C";
  }
  setTimeout(() => { boton.textContent = "Copiar"; }, 2500);
}

async function buscarEntrada(evento) {
  evento.preventDefault();
  const datos = Object.fromEntries(new FormData(evento.target));
  mensajeEntradas("Buscando…");
  try {
    const entrada = await api(
      `/api/entradas/${datos.codigo.trim()}?email=${encodeURIComponent(datos.email.trim())}`);
    anotarCompra(entrada.codigo, datos.email.trim());
    evento.target.reset();
    mensajeEntradas("");
    await mostrarEntradas();
  } catch (e) {
    mensajeEntradas(e.message, "error");
  }
}

// ---------------- navegación ----------------

// Cada cambio de pantalla recibe un número; así una carga lenta sabe si
// todavía es la pantalla que el usuario está viendo.
let viajeActual = 0;

function limpiarCompra() {
  clearInterval(estado.refresco);
  clearInterval(estado.temporizador);
  estado.refresco = null;
  estado.temporizador = null;
  estado.reserva = null;
}

async function enrutar() {
  limpiarCompra();
  const viaje = ++viajeActual;
  const partes = (location.hash.replace(/^#/, "") || "/").split("/").filter(Boolean);
  try {
    if (partes[0] === "mis-entradas") await mostrarEntradas();
    else if (partes[0] === "evento") await mostrarDetalle(Number(partes[1]));
    else if (partes[0] === "comprar") await iniciarCompra(Number(partes[1]), viaje);
    else await mostrarCatalogo();
  } catch (e) {
    if (e.status === 404) {
      location.hash = "#/";
      return;
    }
    throw e;
  }
}

async function iniciar() {
  const cfg = await api("/api/config");
  estado.cfg = cfg;
  estado.modo = cfg.modo;
  $("minutos-reserva").textContent = cfg.reserva_minutos;
  $("modo").textContent = "modo: " + cfg.modo;

  if (estado.modo === "sala") {
    estado.pase = leer("pase");
  } else {
    estado.sesion = leer("sesion") || idAleatorio();
    guardar("sesion", estado.sesion);
  }

  window.addEventListener("hashchange", () => enrutar().catch(falloGeneral));
  await enrutar();
}

function idAleatorio() {
  // crypto.randomUUID solo existe en https o localhost
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function falloGeneral(e) {
  console.error(e);
  $("vista-detalle").hidden = true;
  $("vista-catalogo").innerHTML =
    '<p class="nota" style="text-align:center;margin:60px 0">' +
    "No se pudo conectar con el servidor. Revisa que esté levantado y recarga la página.</p>";
  $("vista-catalogo").hidden = false;
}

$("form-pago").addEventListener("submit", pagar);
$("btn-cancelar").addEventListener("click", cancelar);
$("btn-otra").addEventListener("click", () => { mostrarPanel("vacio"); mensaje(""); cargarAsientos(); });
$("btn-ver-entrada").addEventListener("click", () => { location.hash = "#/mis-entradas"; });
$("form-buscar").addEventListener("submit", buscarEntrada);
$("lista-entradas").addEventListener("click", (e) => {
  const boton = e.target.closest(".copiar");
  if (boton) copiarTexto(boton);
});

iniciar().catch(falloGeneral);
