import { useState, useEffect, useRef } from "react";
import CheckoutCulqiModal from "./components/CheckoutCulqiModal";

const BACKEND_URL = "";

interface SectorTarifa {
  id: string;
  nombre: string;
  tipo: string;
  preventa: number;
  full: number;
  conadis: number | null;
  agotadoPreventa?: boolean;
  agotadoFull?: boolean;
  agotadoConadis?: boolean;
  color: string;
}

const SECTORES: SectorTarifa[] = [
  { id: "s_campo_a", nombre: "CAMPO A", tipo: "STAND UP", preventa: 270.0, full: 320.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#C06C23" },
  { id: "s_campo_b", nombre: "CAMPO B", tipo: "STAND UP", preventa: 125.0, full: 147.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#D85830" },
  { id: "s_occ_1", nombre: "TRIBUNA OCCIDENTE 1", tipo: "NUMERADO", preventa: 185.0, full: 217.0, conadis: 173.0, agotadoPreventa: false, agotadoFull: false, agotadoConadis: false, color: "#8E8659" },
  { id: "s_occ_2", nombre: "TRIBUNA OCCIDENTE 2", tipo: "NUMERADO", preventa: 160.0, full: 190.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#1D1D1B" },
  { id: "s_or_1", nombre: "TRIBUNA ORIENTE 1", tipo: "NUMERADO", preventa: 185.0, full: 217.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#8E8659" },
  { id: "s_or_2", nombre: "TRIBUNA ORIENTE 2", tipo: "NUMERADO", preventa: 160.0, full: 190.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#1D1D1B" },
  { id: "s_norte", nombre: "TRIBUNA NORTE", tipo: "SIN NUMERAR", preventa: 80.0, full: 95.0, conadis: null, agotadoPreventa: false, agotadoFull: false, color: "#788882" },
];

export default function App() {
  const [modalCompra, setModalCompra] = useState(false);
  const [modalCulqi, setModalCulqi] = useState(false);
  const [sectorSeleccionado, setSectorSeleccionado] = useState<string>("s_campo_a");
  const [enSala, setEnSala] = useState(false);
  const [ticketCola, setTicketCola] = useState<string | null>(null);
  const [posicionCola, setPosicionCola] = useState<number | null>(null);
  const [paseCompra, setPaseCompra] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [mostrarSpotify, setMostrarSpotify] = useState(false);

  // Estados para el mapa dinámico SVG
  const [svgContent, setSvgContent] = useState<string>("");
  const [tooltip, setTooltip] = useState<{ texto: string; x: number; y: number; visible: boolean }>({
    texto: "",
    x: 0,
    y: 0,
    visible: false,
  });
  const planoRef = useRef<HTMLDivElement>(null);

  // 1. Cargar el mapa SVG una sola vez
  useEffect(() => {
    fetch("/mapa.svg")
      .then((res) => res.text())
      .then((raw) => {
        // Asegurar que el SVG use viewBox responsivo y no desborde
        setSvgContent(raw);
      })
      .catch((err) => console.error("Error cargando mapa SVG:", err));
  }, []);

  // 2. Gestionar eventos dinámicos y clases active/dimmed en el SVG
  useEffect(() => {
    if (!svgContent || !planoRef.current) return;
    const contenedor = planoRef.current;
    const zonas = contenedor.querySelectorAll<SVGGraphicsElement>('[id^="s_"]');

    const handleMouseEnter = (e: MouseEvent) => {
      const target = (e.currentTarget as SVGGraphicsElement);
      const nombre = target.dataset.name || target.id;
      setTooltip({ texto: nombre, x: e.clientX, y: e.clientY, visible: true });
    };

    const handleMouseMove = (e: MouseEvent) => {
      setTooltip((prev) => ({ ...prev, x: e.clientX, y: e.clientY }));
    };

    const handleMouseLeave = () => {
      setTooltip((prev) => ({ ...prev, visible: false }));
    };

    const handleClick = (e: MouseEvent) => {
      const target = (e.currentTarget as SVGGraphicsElement);
      if (target.id) {
        setSectorSeleccionado(target.id);
      }
    };

    zonas.forEach((zona) => {
      zona.addEventListener("mouseenter", handleMouseEnter);
      zona.addEventListener("mousemove", handleMouseMove);
      zona.addEventListener("mouseleave", handleMouseLeave);
      zona.addEventListener("click", handleClick);

      // Resaltar sector seleccionado y atenuar el resto
      if (sectorSeleccionado) {
        if (zona.id === sectorSeleccionado) {
          zona.classList.add("active");
          zona.classList.remove("dimmed");
        } else {
          zona.classList.remove("active");
          zona.classList.add("dimmed");
        }
      } else {
        zona.classList.remove("active", "dimmed");
      }
    });

    return () => {
      zonas.forEach((zona) => {
        zona.removeEventListener("mouseenter", handleMouseEnter);
        zona.removeEventListener("mousemove", handleMouseMove);
        zona.removeEventListener("mouseleave", handleMouseLeave);
        zona.removeEventListener("click", handleClick);
      });
    };
  }, [svgContent, sectorSeleccionado]);

  // Iniciar flujo de compra pasando por la Sala de Espera de Go
  const iniciarCompra = async (sectorId?: string) => {
    if (sectorId) setSectorSeleccionado(sectorId);
    setModalCompra(true);
    setCargando(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/sala/entrar`, { method: "POST" });
      if (!res.ok) throw new Error("Error ingresando a la cola");
      const data = await res.json();
      setTicketCola(data.ticket);
      setPosicionCola(data.posicion);
      setEnSala(true);
    } catch {
      setPaseCompra("demo_pase_local");
      setEnSala(false);
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    if (!enSala || !ticketCola) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/api/sala/${ticketCola}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.estado === "admitido") {
          setPaseCompra(data.pase);
          setEnSala(false);
          clearInterval(interval);
        } else {
          setPosicionCola(data.posicion);
        }
      } catch (err) {
        console.error("Error consultando sala:", err);
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [enSala, ticketCola]);

  useEffect(() => {
    // Si viene con pase en el hash (ej. #/comprar/1?pase=XYZ), abrir pasarela Culqi
    const hash = window.location.hash;
    if (hash.includes("comprar")) {
      const match = /pase=([^&]+)/.exec(hash);
      if (match?.[1]) {
        setPaseCompra(decodeURIComponent(match[1]));
      }
      setModalCulqi(true);
    }
  }, []);

  const renderPrecioConadis = (s: SectorTarifa) => {
    if (!s.conadis) {
      return <span className="text-gray-400 font-bold">----</span>;
    }
    if (s.agotadoConadis) {
      return (
        <span className="inline-block bg-[#D31411] text-white text-[9px] font-black px-3 py-1 rounded-sm uppercase tracking-wider shadow-xs">
          AGOTADO
        </span>
      );
    }
    return (
      <span className="font-bold text-xs text-gray-700">
        S/ {s.conadis.toFixed(2)}
      </span>
    );
  };

  const renderContenidoModalCompra = () => {
    if (cargando) {
      return (
        <div className="py-8 space-y-3">
          <div className="w-10 h-10 border-4 border-[#D31411] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-gray-600">Conectando con la Sala de Espera...</p>
        </div>
      );
    }

    if (enSala) {
      return (
        <div className="py-4 space-y-3">
          <div className="inline-block bg-yellow-100 text-yellow-800 px-3 py-1 rounded-full text-xs font-black">
            ESTÁS EN LA COLA VIRTUAL
          </div>
          <h4 className="text-lg font-extrabold text-[#1F1F1F]">PAULO LONDRA · LIMA 2026</h4>
          <p className="text-xs text-gray-500">
            Por favor mantén esta ventana abierta. Tu turno avanzará automáticamente.
          </p>

          <div className="border border-gray-200 rounded-md p-4 bg-gray-50 space-y-1">
            <span className="text-[10px] text-gray-400 uppercase font-bold block">TU LUGAR EN LA COLA</span>
            <span className="text-4xl font-black text-[#D31411]">
              {posicionCola !== null ? `#${posicionCola}` : "Verificando..."}
            </span>
            <span className="text-[11px] text-gray-500 block pt-1">
              Ticket ID: <code className="font-mono text-gray-700">{ticketCola}</code>
            </span>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
            <div className="bg-[#D31411] h-1.5 rounded-full animate-pulse w-3/4" />
          </div>
        </div>
      );
    }

    return (
      <div className="py-4 space-y-4">
        <div className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-black">
          ¡ES TU TURNO DE COMPRAR!
        </div>
        <h4 className="text-lg font-extrabold text-[#1F1F1F]">Selecciona tu Entrada</h4>
        <p className="text-xs text-gray-600">
          Tienes 5 minutos para completar tu reserva antes de que el pase expire.
        </p>

        <div className="text-left space-y-2 max-h-48 overflow-y-auto pr-1">
          {SECTORES.map(s => (
            <button
              type="button"
              key={s.id}
              disabled={s.agotadoFull}
              onClick={() => setSectorSeleccionado(s.id)}
              className={`w-full flex justify-between items-center p-2.5 border rounded-sm text-xs transition-all ${
                sectorSeleccionado === s.id ? "border-[#D31411] bg-red-50/40" : "hover:border-gray-300"
              } ${s.agotadoFull ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
            >
              <div className="text-left">
                <span className="font-bold text-gray-800 block">{s.nombre}</span>
                <span className="text-[10px] text-gray-500">{s.tipo}</span>
              </div>
              <span className="font-extrabold text-[#D31411]">
                {s.agotadoFull ? "AGOTADO" : `S/ ${s.full.toFixed(2)}`}
              </span>
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setModalCompra(false);
            setModalCulqi(true);
          }}
          className="w-full bg-[#D31411] hover:bg-[#b5100d] text-white font-bold text-xs uppercase py-3 rounded-xs tracking-wider cursor-pointer shadow-md transition-all active:scale-95"
        >
          Continuar al Mapa de Butacas y Pago Culqi
        </button>
      </div>
    );
  };

  const sectorActivo = SECTORES.find(s => s.id === sectorSeleccionado) || SECTORES[0];

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#212121]">
      {/* 1. Header Oficial Teleticket Estilo Especial Landing */}
      <header className="sticky top-0 z-50 bg-[#121212] border-b border-white/10 shadow-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between">
          <a href="#page-top" className="flex items-center gap-2">
            <img
              src="https://cdn.teleticket.com.pe/images/logo-teleticket-2022.png"
              alt="Teleticket"
              className="h-7 sm:h-8 object-contain"
            />
          </a>

          <nav className="flex items-center gap-4 sm:gap-7 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-gray-300">
            <a href="#page-top" className="hover:text-white transition-colors">INICIO</a>
            <a href="#price-section" className="hover:text-white transition-colors">PRECIOS</a>
            <a href="#botonera" className="hover:text-white transition-colors">COMPRAR</a>
            <a href="#info" className="hover:text-white transition-colors">INFO EVENTO</a>
            <a href="#legales" className="hover:text-white transition-colors">LEGALES</a>
          </nav>
        </div>
      </header>

      {/* 2. Banner Principal / Hero Teleticket (Imagen a ancho total responsive) */}
      <section id="page-top" className="w-full bg-[#000000] text-white overflow-hidden">
        <div className="w-full">
          <div className="relative w-full text-center">
            <img
              src="/banner-londra.jpg"
              alt="Paulo Londra - Next Rounds Tour 2026 - Estadio Nacional Lima"
              className="w-full h-auto block object-cover md:object-contain mx-auto max-h-[85vh] sm:max-h-none"
            />
          </div>
        </div>
      </section>

      {/* 3. SECCIÓN OFICIAL DE PRECIOS CON PLANO SVG INTERACTIVO */}
      <section id="price-section" className="py-12 bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="text-center mb-8">
            <p className="text-sm font-bold text-gray-700 flex items-center justify-center gap-1.5 uppercase tracking-wide">
              Selecciona tu sector para ver el precio
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* Columna Izquierda: Plano SVG Dinámico de Teleticket */}
            <div className="lg:col-span-5 flex flex-col items-center">
              <div className="w-full max-w-md bg-white border border-gray-200 rounded-lg p-4 shadow-sm relative">
                <span className="text-[10px] font-black uppercase text-gray-400 tracking-widest block text-center mb-2">
                  PLANO OFICIAL · ESTADIO NACIONAL
                </span>
                
                {/* SVG Oficial Inyectado dinámicamente con interacción directa */}
                <div
                  id="plano"
                  ref={planoRef}
                  className="relative w-full flex items-center justify-center overflow-hidden min-h-[350px]"
                  dangerouslySetInnerHTML={{ __html: svgContent }}
                />

                <div className="flex flex-wrap gap-2 justify-center pt-3 text-[10px] font-bold">
                  {SECTORES.map(s => (
                    <button
                      key={s.id}
                      onClick={() => setSectorSeleccionado(s.id)}
                      className={`px-2 py-1 rounded-xs border transition-all ${
                        sectorSeleccionado === s.id
                          ? "bg-[#D31411] text-white border-[#D31411]"
                          : "bg-gray-100 text-gray-700 hover:border-gray-400"
                      }`}
                    >
                      {s.nombre}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Columna Derecha: Tabla Gráfica Oficial de Teleticket */}
            <div className="lg:col-span-7 space-y-4">
              <div className="overflow-x-auto border border-gray-200 rounded-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200 text-[11px] font-black tracking-wider text-gray-800">
                      <th className="py-3 px-4 bg-gray-50 uppercase">SECTORES</th>
                      <th className="py-3 px-4 text-center bg-[#fdf5eb] text-[#C06C23] border-l border-r border-gray-200">
                        <span className="block text-[10px] font-black tracking-widest">PREVENTA</span>
                        <span className="block text-[12px] font-extrabold text-[#0039A6]">Interbank</span>
                        <span className="text-[9px] font-normal text-gray-500 block leading-tight">Hasta el 21/02 o agotar stock</span>
                      </th>
                      <th className="py-3 px-4 text-center bg-gray-50 border-r border-gray-200">
                        <span className="block text-[10px] font-black tracking-widest text-[#C06C23]">PRECIO FULL</span>
                        <span className="text-[9px] font-normal text-gray-500 block leading-tight">Todos los medios de pago</span>
                      </th>
                      <th className="py-3 px-4 text-center bg-gray-50">
                        <span className="block text-[10px] font-black tracking-widest text-[#C06C23]">CONADIS</span>
                        <span className="text-[9px] font-normal text-gray-500 block leading-tight">Todos los medios de pago</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {SECTORES.map(s => {
                      const esSeleccionado = sectorSeleccionado === s.id;
                      return (
                        <tr
                          key={s.id}
                          onClick={() => setSectorSeleccionado(s.id)}
                          className={`cursor-pointer transition-colors ${
                            esSeleccionado ? "bg-amber-50/70 ring-2 ring-[#C06C23] ring-inset" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="py-3 px-4">
                            <div className="flex items-start gap-2">
                              <span className="w-2.5 h-6 rounded-xs shrink-0" style={{ backgroundColor: s.color }}></span>
                              <div>
                                <span className="font-black text-[#1F1F1F] text-xs block">{s.nombre}</span>
                                <span className="text-[10px] text-gray-500 font-semibold">{s.tipo}</span>
                              </div>
                            </div>
                          </td>

                          {/* Casilla Preventa */}
                          <td className="py-3 px-4 text-center border-l border-r border-gray-200 bg-[#fefaf4]">
                            {s.agotadoPreventa ? (
                              <span className="inline-block bg-[#D31411] text-white text-[9px] font-black px-3 py-1 rounded-sm uppercase tracking-wider shadow-xs">
                                AGOTADO
                              </span>
                            ) : (
                              <span className="font-extrabold text-sm text-[#C06C23]">
                                S/ {s.preventa.toFixed(2)}
                              </span>
                            )}
                          </td>

                          {/* Casilla Precio Full */}
                          <td className="py-3 px-4 text-center border-r border-gray-200">
                            {s.agotadoFull ? (
                              <span className="inline-block bg-[#D31411] text-white text-[9px] font-black px-3 py-1 rounded-sm uppercase tracking-wider shadow-xs">
                                AGOTADO
                              </span>
                            ) : (
                              <span className="font-extrabold text-sm text-[#1F1F1F]">
                                S/ {s.full.toFixed(2)}
                              </span>
                            )}
                          </td>

                          {/* Casilla Conadis */}
                          <td className="py-3 px-4 text-center">
                            {renderPrecioConadis(s)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Botón de compra para el sector activo */}
              <div className="border border-gray-200 rounded-sm p-4 bg-gray-50 flex flex-col sm:flex-row justify-between items-center gap-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-500 block">SECTOR SELECCIONADO</span>
                  <strong className="text-base font-black text-[#1F1F1F]">{sectorActivo.nombre}</strong>
                  <div className="flex flex-wrap gap-2 text-xs font-bold pt-1">
                    <span className="text-[#0039A6] bg-blue-50 px-2 py-0.5 rounded-xs border border-blue-200">
                      Preventa: S/ {sectorActivo.preventa.toFixed(2)}
                    </span>
                    <span className="text-gray-700 bg-gray-100 px-2 py-0.5 rounded-xs border border-gray-200">
                      Full: S/ {sectorActivo.full.toFixed(2)}
                    </span>
                    {sectorActivo.conadis && (
                      <span className="text-[#C06C23] bg-amber-50 px-2 py-0.5 rounded-xs border border-amber-200">
                        CONADIS: S/ {sectorActivo.conadis.toFixed(2)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => iniciarCompra(sectorActivo.id)}
                  disabled={sectorActivo.agotadoFull}
                  className={`w-full sm:w-auto font-black text-xs uppercase px-8 py-3.5 rounded-xs tracking-wider transition-all shadow-md ${
                    sectorActivo.agotadoFull
                      ? "bg-gray-400 cursor-not-allowed text-white"
                      : "bg-[#D31411] hover:bg-[#b5100d] text-white active:scale-95"
                  }`}
                >
                  {sectorActivo.agotadoFull ? "SECTOR AGOTADO" : "COMPRAR ENTRADAS"}
                </button>
              </div>

              {/* Banner informativo E-Tickets */}
              <div className="border border-[#C06C23] rounded-md p-3.5 text-center text-xs text-[#C06C23] font-semibold bg-[#fffaf5]">
                La descarga de los E-tickets estará disponible desde 2 días antes de la fecha de tu evento o función.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Información del Evento y Multimedia */}
      <section id="info" className="py-12 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 grid grid-cols-1 md:grid-cols-2 gap-8 text-xs leading-relaxed text-gray-700">
          <div>
            <h3 className="text-base font-bold text-[#1F1F1F] uppercase mb-3 border-b-2 border-[#D31411] pb-1 inline-block">
              ACERCA DEL EVENTO
            </h3>
            <p className="mb-3">
              El coloso de José Díaz será el epicentro de una noche diseñada para ser legendaria. Paulo Londra llega a Lima para repasar los éxitos de su carrera y los temas que lo convirtieron en un referente de la música urbana internacional.
            </p>
            <ul className="space-y-1.5 list-disc list-inside text-gray-600 mb-6">
              <li><strong>Organizador:</strong> CONCERTS SPORTS AEI10 S.A.C. (RUC: 20613825607)</li>
              <li><strong>Público Recomendado:</strong> Mayores de 18 años.</li>
              <li><strong>Ingreso de Menores:</strong> A partir de 5 años acompañados de un adulto responsable.</li>
              <li><strong>Descarga de E-Tickets:</strong> Disponible desde 2 días antes de la fecha del evento.</li>
            </ul>
          </div>

          <div id="legales">
            <h3 className="text-base font-bold text-[#1F1F1F] uppercase mb-3 border-b-2 border-[#D31411] pb-1 inline-block">
              SALA DE ESPERA VIRTUAL Y SEGURIDAD
            </h3>
            <p className="mb-3">
              Para garantizar que todos los fanáticos tengan la misma oportunidad y evitar la saturación por tráfico masivo o bots de reventa, Teleticket implementa la <strong>COLA VIRTUAL</strong>.
            </p>
            <p className="mb-2">
              Al hacer click en comprar, ingresarás a la sala de espera donde se asigna un orden aleatorio de llegada. Los pases de acceso están firmados criptográficamente para evitar suplantaciones.
            </p>
          </div>
        </div>
      </section>

      {/* 5. Footer Overlay Flotante Mobile (get-tickets-container) */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 py-2.5 px-4 lg:hidden shadow-[0_-4px_10px_rgba(0,0,0,0.08)]">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-black uppercase text-[#1F1F1F]">Obtén tus tickets</span>
            <span className="text-[10px] text-gray-500">Desde S/ 80.00</span>
          </div>
          <button
            onClick={() => iniciarCompra()}
            className="bg-[#D31411] hover:bg-[#b5100d] text-white font-extrabold text-xs uppercase px-5 py-2.5 rounded-xs flex items-center gap-1.5 shadow-md active:scale-95"
          >
            <svg className="w-3.5 h-3.5" aria-hidden="true" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <span>Tickets</span>
          </button>
        </div>
      </div>

      {/* 6. Spotify Floating Action Button (FAB) Flotante persistente con el Scroll */}
      <div className="fixed bottom-16 lg:bottom-6 right-5 z-40 flex flex-col items-end">
        {mostrarSpotify && (
          <div className="relative mb-3 w-80 sm:w-96 rounded-2xl shadow-2xl overflow-hidden border border-white/10 bg-black/90 backdrop-blur-lg animate-in fade-in slide-in-from-bottom-4 duration-200">
            <button
              type="button"
              onClick={() => setMostrarSpotify(false)}
              className="absolute top-2 left-2 z-10 w-6 h-6 flex items-center justify-center rounded-full bg-black/70 hover:bg-black text-gray-300 hover:text-white transition-all cursor-pointer text-xs shadow-md border border-white/10"
              title="Cerrar reproductor"
              aria-label="Cerrar reproductor de Spotify"
            >
              ✕
            </button>
            <iframe
              data-testid="embed-iframe"
              className="reproductor w-full border-0 block"
              style={{ borderRadius: "16px", height: "152px" }}
              src="https://open.spotify.com/embed/artist/3vQ0GE3mI0dAaxIMYe5g7z?utm_source=generator&theme=0"
              allowFullScreen
              allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
              loading="lazy"
              title="Paulo Londra en Spotify"
            ></iframe>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMostrarSpotify(!mostrarSpotify)}
          className="group relative flex items-center bg-[#1DB954] hover:bg-[#1aa34a] text-white p-3.5 rounded-full shadow-2xl transition-all duration-300 hover:pr-4.5 active:scale-95 cursor-pointer"
          title="Escuchar a Paulo Londra"
          aria-label={mostrarSpotify ? "Cerrar reproductor de Spotify" : "Escuchar a Paulo Londra en Spotify"}
        >
          <svg className="w-6 h-6 fill-current shrink-0" aria-hidden="true" viewBox="0 0 24 24">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
          <span className="max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-all duration-300 ease-out group-hover:max-w-xs group-hover:opacity-100 group-hover:ml-2 font-bold text-xs tracking-wide">
            {mostrarSpotify ? "Cerrar Música" : "Escuchar Hits"}
          </span>
        </button>
      </div>

      {/* 7. Footer Oficial Teleticket */}
      <footer className="mt-auto bg-[#1F1F1F] text-gray-400 text-xs py-8 pb-16 lg:pb-8 border-t border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2 text-white font-bold text-lg">
            <span className="bg-[#D31411] text-white px-1.5 py-0.5 rounded-xs font-black text-sm">T</span>
            <span>TELETICKET</span>
          </div>
          <p className="text-[11px] text-gray-500">
            © 2026 Teleticket. Todos los derechos reservados. Powered by Go High-Concurrency Engine.
          </p>
          <div className="flex gap-4 text-[11px]">
            <a href="#legales" className="hover:text-white">Términos y Condiciones</a>
            <a href="#legales" className="hover:text-white">Políticas de Privacidad</a>
          </div>
        </div>
      </footer>

      {/* 8. Modal Interactivo: Cola Virtual / Proceso de Compra */}
      {modalCompra && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 text-center space-y-4 relative">
            <button
              onClick={() => { setModalCompra(false); setEnSala(false); }}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-lg font-bold"
            >
              ✕
            </button>

            {renderContenidoModalCompra()}
          </div>
        </div>
      )}

      {/* Modal Flotante de Pasarela Culqi, Butacas y E-Ticket */}
      {modalCulqi && (
        <CheckoutCulqiModal
          eventoId={1}
          pase={paseCompra}
          onCerrar={() => setModalCulqi(false)}
          onExpirarPase={() => {
            setModalCulqi(false);
            setPaseCompra(null);
            alert("Tu pase de sala de espera venció. Ingresando de nuevo a la cola...");
            void iniciarCompra();
          }}
        />
      )}

      {/* Tooltip Dinámico Flotante de Sectores SVG */}
      {tooltip.visible && (
        <div
          className="map-tooltip"
          style={{
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
          }}
        >
          {tooltip.texto}
        </div>
      )}
    </div>
  );
}
