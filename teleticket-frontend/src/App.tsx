import { useState, useEffect } from "react";

const BACKEND_URL = "http://127.0.0.1:8000";

interface SectorTarifa {
  nombre: string;
  preventa: number;
  full: number;
  conadis: number | null;
  tipo: string;
  color: string;
}

const SECTORES: SectorTarifa[] = [
  { nombre: "CAMPO A", preventa: 270.0, full: 320.0, conadis: null, tipo: "STAND UP", color: "#E53935" },
  { nombre: "CAMPO B", preventa: 125.0, full: 147.0, conadis: null, tipo: "STAND UP", color: "#FB8C00" },
  { nombre: "TRIBUNA OCCIDENTE 1", preventa: 185.0, full: 217.0, conadis: 173.0, tipo: "NUMERADO", color: "#1E88E5" },
  { nombre: "TRIBUNA OCCIDENTE 2", preventa: 160.0, full: 190.0, conadis: null, tipo: "NUMERADO", color: "#43A047" },
  { nombre: "TRIBUNA ORIENTE 1", preventa: 185.0, full: 217.0, conadis: null, tipo: "NUMERADO", color: "#8E24AA" },
  { nombre: "TRIBUNA ORIENTE 2", preventa: 160.0, full: 190.0, conadis: null, tipo: "NUMERADO", color: "#00ACC1" },
  { nombre: "TRIBUNA NORTE", preventa: 80.0, full: 95.0, conadis: null, tipo: "SIN NUMERAR", color: "#FDD835" },
];

export default function App() {
  const [modalCompra, setModalCompra] = useState(false);
  const [enSala, setEnSala] = useState(false);
  const [ticketCola, setTicketCola] = useState<string | null>(null);
  const [posicionCola, setPosicionCola] = useState<number | null>(null);
  const [paseCompra, setPaseCompra] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  // Iniciar flujo de compra pasando por la Sala de Espera de Go
  const iniciarCompra = async () => {
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
      // Si el backend no está disponible localmente, simula acceso directo
      setPaseCompra("demo_pase_local");
      setEnSala(false);
    } finally {
      setCargando(false);
    }
  };

  // Sondeo periódico de posición en la cola virtual
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

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#212121]">
      {/* 1. Header Oficial Teleticket */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-xs">
        {/* Barra superior de enlaces */}
        <div className="bg-[#1F1F1F] text-white text-[11px] py-1.5 px-4 sm:px-8 flex justify-between items-center">
          <div className="flex gap-4">
            <span className="hover:text-gray-300 cursor-pointer font-medium">Inicio</span>
            <span className="hover:text-gray-300 cursor-pointer">Puntos de Venta</span>
            <span className="hover:text-gray-300 cursor-pointer">Ayuda / Preguntas Frecuentes</span>
          </div>
          <div className="flex gap-4">
            <span className="hover:text-gray-300 cursor-pointer">Libro de Reclamaciones</span>
          </div>
        </div>

        {/* Barra principal de navegación */}
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <a href="#page-top" className="flex items-center gap-1 font-black text-2xl tracking-tighter text-[#D31411]">
              <span className="bg-[#D31411] text-white px-2 py-0.5 rounded-sm font-extrabold text-xl">T</span>
              <span>TELETICKET</span>
            </a>
            <button className="hidden md:flex items-center gap-2 text-sm font-semibold text-gray-700 hover:text-[#D31411]">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
              CATEGORÍAS
            </button>
          </div>

          <div className="flex-1 max-w-md hidden sm:block">
            <div className="relative">
              <input
                type="text"
                placeholder="Busca por artista, evento o lugar..."
                className="w-full text-xs bg-gray-100 border border-gray-300 rounded-full py-2 pl-4 pr-10 focus:outline-hidden focus:border-[#D31411]"
              />
              <svg className="w-4 h-4 absolute right-3 top-2.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-2 cursor-pointer hover:text-[#D31411]">
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span>INGRESAR / REGÍSTRATE</span>
            </div>
          </div>
        </div>

        {/* Submenú de secciones del evento */}
        <nav className="bg-[#D31411] text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-8 flex overflow-x-auto text-xs font-bold uppercase tracking-wider py-2.5 gap-6">
            <a href="#page-top" className="hover:text-gray-200 shrink-0">INICIO</a>
            <a href="#precios" className="hover:text-gray-200 shrink-0">PRECIOS</a>
            <a href="#botonera" className="hover:text-gray-200 shrink-0 text-yellow-300">COMPRAR</a>
            <a href="#info" className="hover:text-gray-200 shrink-0">INFO EVENTO</a>
            <a href="#multimedia" className="hover:text-gray-200 shrink-0">MULTIMEDIA</a>
            <a href="#legales" className="hover:text-gray-200 shrink-0">LEGALES</a>
          </div>
        </nav>
      </header>

      {/* 2. Banner Principal / Hero de Paulo Londra */}
      <section id="page-top" className="relative bg-[#0d0d11] text-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-10 lg:py-16 grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-7 space-y-4">
            <div className="inline-flex items-center gap-2 bg-[#D31411] text-white text-[10px] font-black uppercase px-2.5 py-1 rounded-xs tracking-wider">
              <span>PREVENTA EXCLUSIVA INTERBANK</span>
            </div>
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight leading-none text-white">
              PAULO LONDRA
            </h1>
            <p className="text-xl sm:text-2xl font-light text-gray-300 tracking-wide uppercase">
              NEXT ROUNDS TOUR · LIMA 2026
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 text-xs">
              <div className="border border-white/10 bg-white/5 p-3 rounded-sm">
                <span className="text-gray-400 block text-[10px] uppercase font-bold">FECHA</span>
                <span className="font-semibold text-white">Sábado 29 Agosto 2026</span>
              </div>
              <div className="border border-white/10 bg-white/5 p-3 rounded-sm">
                <span className="text-gray-400 block text-[10px] uppercase font-bold">RECINTO</span>
                <span className="font-semibold text-white">Estadio Nacional</span>
              </div>
              <div className="border border-white/10 bg-white/5 p-3 rounded-sm col-span-2 sm:col-span-1">
                <span className="text-gray-400 block text-[10px] uppercase font-bold">HORA</span>
                <span className="font-semibold text-white">09:00 PM</span>
              </div>
            </div>

            <div id="botonera" className="pt-4 flex flex-wrap gap-4 items-center">
              <button
                onClick={iniciarCompra}
                className="bg-[#D31411] hover:bg-[#b5100d] text-white font-extrabold text-sm uppercase px-8 py-4 rounded-xs shadow-lg transition-transform active:scale-95 flex items-center gap-2"
              >
                <span>COMPRAR ENTRADAS</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
              <span className="text-xs text-gray-300 font-medium">
                Hasta <strong className="text-yellow-400 font-bold">15% de dscto</strong> con Tarjetas Interbank
              </span>
            </div>
          </div>

          <div className="lg:col-span-5 flex justify-center">
            <div className="relative border-4 border-white/10 rounded-lg overflow-hidden shadow-2xl max-w-sm w-full bg-gradient-to-t from-black via-gray-900 to-gray-800 p-6 text-center space-y-4">
              <div className="w-20 h-20 mx-auto rounded-full bg-[#D31411]/20 flex items-center justify-center border-2 border-[#D31411]">
                <span className="text-3xl font-black text-white">PL</span>
              </div>
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">Estadio Nacional · Lima</h3>
              <p className="text-xs text-gray-400 leading-relaxed">
                El regreso más esperado a los escenarios peruanos. Capacidad controlada mediante Sala de Espera Virtual.
              </p>
              <div className="border-t border-white/10 pt-4 flex justify-around text-xs">
                <div>
                  <span className="text-gray-400 block">DESDE</span>
                  <strong className="text-lg text-white">S/ 80.00</strong>
                </div>
                <div>
                  <span className="text-gray-400 block">AFORO</span>
                  <strong className="text-lg text-white">50,000</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Sección de Precios y Plano de Sectores */}
      <section id="precios" className="py-12 bg-gray-50 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <span className="text-[#D31411] text-xs font-black uppercase tracking-widest block mb-1">
              TARIFAS Y UBICACIONES
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#1F1F1F]">
              SECTORES Y PRECIOS
            </h2>
            <p className="text-xs text-gray-500 mt-1 max-w-lg mx-auto">
              Precios válidos en preventa con tarjetas Interbank o hasta agotar stock asignado.
            </p>
          </div>

          {/* Tabla de Tarifas Exactas */}
          <div className="overflow-x-auto bg-white rounded-md border border-gray-200 shadow-xs mb-8">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-[#1F1F1F] text-white uppercase text-[11px] tracking-wider">
                  <th className="py-3 px-4 font-bold">SECTOR</th>
                  <th className="py-3 px-4 font-bold">TIPO</th>
                  <th className="py-3 px-4 font-bold text-yellow-400 bg-[#2b2b2b]">
                    PREVENTA INTERBANK (-15%)
                  </th>
                  <th className="py-3 px-4 font-bold">PRECIO FULL</th>
                  <th className="py-3 px-4 font-bold">CONADIS</th>
                  <th className="py-3 px-4 font-bold text-center">ACCIÓN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {SECTORES.map((s, idx) => (
                  <tr key={idx} className="hover:bg-gray-50 transition-colors">
                    <td className="py-3.5 px-4 font-extrabold text-[#1F1F1F] flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color }}></span>
                      {s.nombre}
                    </td>
                    <td className="py-3.5 px-4 text-gray-500 font-medium">{s.tipo}</td>
                    <td className="py-3.5 px-4 font-bold text-[#D31411] bg-red-50/50">
                      S/ {s.preventa.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-gray-700 font-semibold">
                      S/ {s.full.toFixed(2)}
                    </td>
                    <td className="py-3.5 px-4 text-gray-600">
                      {s.conadis ? `S/ ${s.conadis.toFixed(2)}` : "—"}
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <button
                        onClick={iniciarCompra}
                        className="bg-[#D31411] hover:bg-[#b5100d] text-white text-[11px] font-bold py-1.5 px-4 rounded-xs uppercase tracking-wider"
                      >
                        Comprar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-md p-4 flex items-start gap-3 text-xs text-blue-900">
            <svg className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <strong>Condición de Preventa:</strong> Válido para Tarjetas de Crédito y Débito Interbank del 20 al 21 de febrero de 2026 o hasta agotar stock de 23,200 entradas. Máximo 6 entradas por cliente.
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

            <div id="multimedia" className="pt-2">
              <h3 className="text-base font-bold text-[#1F1F1F] uppercase mb-3 border-b-2 border-[#D31411] pb-1 inline-block">
                MULTIMEDIA
              </h3>
              <div className="w-full max-w-md">
                <iframe
                  data-testid="embed-iframe"
                  className="reproductor w-full"
                  style={{ borderRadius: "12px", height: "152px" }}
                  src="https://open.spotify.com/embed/artist/3vQ0GE3mI0dAaxIMYe5g7z?utm_source=generator"
                  frameBorder="0"
                  allowFullScreen
                  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                  loading="lazy"
                  title="Paulo Londra en Spotify"
                ></iframe>
              </div>
            </div>
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
            onClick={iniciarCompra}
            className="bg-[#D31411] hover:bg-[#b5100d] text-white font-extrabold text-xs uppercase px-5 py-2.5 rounded-xs flex items-center gap-1.5 shadow-md active:scale-95"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
            </svg>
            <span>Tickets</span>
          </button>
        </div>
      </div>

      {/* 6. Footer Oficial Teleticket */}
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

      {/* 6. Modal Interactivo: Cola Virtual / Proceso de Compra */}
      {modalCompra && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6 text-center space-y-4 relative">
            <button
              onClick={() => { setModalCompra(false); setEnSala(false); }}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-lg font-bold"
            >
              ✕
            </button>

            {cargando ? (
              <div className="py-8 space-y-3">
                <div className="w-10 h-10 border-4 border-[#D31411] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-semibold text-gray-600">Conectando con la Sala de Espera...</p>
              </div>
            ) : enSala ? (
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
                  <div className="bg-[#D31411] h-1.5 rounded-full animate-pulse w-3/4"></div>
                </div>
              </div>
            ) : (
              <div className="py-4 space-y-4">
                <div className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-black">
                  ¡ES TU TURNO DE COMPRAR!
                </div>
                <h4 className="text-lg font-extrabold text-[#1F1F1F]">Selecciona tu Entrada</h4>
                <p className="text-xs text-gray-600">
                  Tienes 5 minutos para completar tu reserva antes de que el pase expire.
                </p>

                <div className="text-left space-y-2 max-h-48 overflow-y-auto pr-1">
                  {SECTORES.map((s, idx) => (
                    <div key={idx} className="flex justify-between items-center p-2.5 border rounded-sm hover:border-[#D31411] cursor-pointer text-xs">
                      <div>
                        <span className="font-bold text-gray-800 block">{s.nombre}</span>
                        <span className="text-[10px] text-gray-500">{s.tipo}</span>
                      </div>
                      <span className="font-extrabold text-[#D31411]">S/ {s.preventa.toFixed(2)}</span>
                    </div>
                  ))}
                </div>

                <a
                  href={`${BACKEND_URL}/#/comprar/1${paseCompra ? `?pase=${paseCompra}` : ""}`}
                  className="block w-full bg-[#D31411] hover:bg-[#b5100d] text-white font-bold text-xs uppercase py-3 rounded-xs tracking-wider"
                >
                  Continuar al Mapa de Butacas
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
