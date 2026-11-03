import { useState, useEffect } from "react";
import type { AsientoBackend, ReservaActiva, EntradaGenerada } from "../types/compra";

interface Props {
  eventoId: number;
  pase: string | null;
  onCerrar: () => void;
  onExpirarPase: () => void;
}

export default function CheckoutCulqiModal({
  eventoId,
  pase,
  onCerrar,
  onExpirarPase,
}: Props) {
  const [asientos, setAsientos] = useState<AsientoBackend[]>([]);
  const [reserva, setReserva] = useState<ReservaActiva | null>(null);
  const [tiempoRestante, setTiempoRestante] = useState<number>(0);
  const [cargando, setCargando] = useState(false);
  const [procesandoPago, setProcesandoPago] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);
  const [entradaEmitida, setEntradaEmitida] = useState<EntradaGenerada | null>(null);

  // Formulario de tarjeta Culqi
  const [form, setForm] = useState({
    comprador: "",
    email: "",
    numero: "",
    vencimiento: "",
    cvv: "",
  });

  const getHeaders = () => {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (pase) {
      h["X-Pase"] = pase;
    }
    return h;
  };

  // 1. Cargar asientos del evento desde el backend Go
  const cargarAsientos = async () => {
    try {
      setCargando(true);
      const res = await fetch(`/api/eventos/${eventoId}/asientos`, {
        headers: getHeaders(),
      });
      if (res.status === 403) {
        onExpirarPase();
        return;
      }
      if (!res.ok) {
        throw new Error("No se pudo cargar el mapa de butacas");
      }
      const data: AsientoBackend[] = await res.json();
      setAsientos(data);

      const mio = data.find((a) => a.mio);
      if (mio && !reserva) {
        setReserva({
          id: mio.id,
          etiqueta: `${mio.fila}-${mio.numero}`,
          precio: mio.precio,
          hasta: mio.reservado_hasta ? new Date(mio.reservado_hasta) : new Date(Date.now() + 300000),
        });
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setMensajeError(err.message);
      }
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarAsientos();
    const interval = setInterval(cargarAsientos, 6000);
    return () => clearInterval(interval);
  }, [eventoId]);

  // 2. Temporizador de reserva de asiento (5 minutos)
  useEffect(() => {
    if (!reserva) return;
    const interval = setInterval(() => {
      const segs = Math.max(0, Math.round((reserva.hasta.getTime() - Date.now()) / 1000));
      setTiempoRestante(segs);
      if (segs <= 0) {
        setReserva(null);
        setMensajeError("El tiempo de reserva expiró. El asiento fue liberado.");
        cargarAsientos();
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [reserva]);

  // 3. Apartar asiento temporalmente
  const handleReservar = async (asiento: AsientoBackend) => {
    setMensajeError(null);
    try {
      const res = await fetch("/api/reservas", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({ asiento_id: asiento.id }),
      });
      if (res.status === 403) {
        onExpirarPase();
        return;
      }
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.detail || "Asiento no disponible");
      }
      const r = await res.json();
      setReserva({
        id: asiento.id,
        etiqueta: `${asiento.fila}-${asiento.numero}`,
        precio: asiento.precio,
        hasta: new Date(r.reservado_hasta),
      });
      cargarAsientos();
    } catch (err: unknown) {
      if (err instanceof Error) {
        setMensajeError(err.message);
      }
    }
  };

  // 4. Liberar asiento
  const handleCancelarReserva = async () => {
    if (!reserva) return;
    try {
      await fetch(`/api/reservas/${reserva.id}`, {
        method: "DELETE",
        headers: getHeaders(),
      });
    } catch {
      // Ignorar si ya expiró
    }
    setReserva(null);
    cargarAsientos();
  };

  // 5. Tokenizar con Culqi y Confirmar Compra
  const handlePagarCulqi = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reserva) return;
    setProcesandoPago(true);
    setMensajeError(null);

    try {
      // Paso 1: Tokenización con Culqi (Simulador PCI-DSS)
      const tokenRes = await fetch("/simulador-pasarela/tokenizar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          numero: form.numero.replace(/\s+/g, ""),
          vencimiento: form.vencimiento,
          cvv: form.cvv,
          titular: form.comprador,
        }),
      });

      if (!tokenRes.ok) {
        const errJson = await tokenRes.json().catch(() => ({}));
        throw new Error(errJson.detail || "Tarjeta rechazada por Culqi");
      }
      const tokData = await tokenRes.json();

      // Paso 2: Ejecutar Cargo Seguro contra el Backend Go
      const pagoRes = await fetch("/api/pagos", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          asiento_id: reserva.id,
          comprador: form.comprador,
          email: form.email,
          token_pago: tokData.token,
        }),
      });

      if (pagoRes.status === 403) {
        onExpirarPase();
        return;
      }

      if (!pagoRes.ok) {
        const pagoErr = await pagoRes.json().catch(() => ({}));
        throw new Error(pagoErr.detail || "Error al procesar el pago");
      }

      const orden = await pagoRes.json();

      // Paso 3: Consultar Entrada Emitida con QR Oficial
      const entradaRes = await fetch(`/api/entradas/${orden.codigo}?email=${encodeURIComponent(form.email)}`);
      if (entradaRes.ok) {
        const ticket = await entradaRes.json();
        setEntradaEmitida(ticket);
      } else {
        setEntradaEmitida({
          codigo: orden.codigo,
          evento: "PAULO LONDRA · NEXT ROUNDS TOUR 2026",
          lugar: "Estadio Nacional · Lima",
          fecha: "2026-08-29",
          zona: "CAMPO A",
          asiento: reserva.etiqueta,
          comprador: form.comprador,
          monto: orden.monto,
          tarjeta_ultimos4: orden.tarjeta.slice(-4),
          qr: `<svg viewBox="0 0 100 100"><rect width="100" height="100" fill="#000"/></svg>`,
          qr_texto: `ENTRADA-${orden.codigo}`,
        });
      }

      setReserva(null);
    } catch (err: unknown) {
      if (err instanceof Error) {
        setMensajeError(err.message);
      }
    } finally {
      setProcesandoPago(false);
    }
  };

  // Formato mm:ss
  const formatTiempo = (segundos: number) => {
    const m = Math.floor(segundos / 60);
    const s = segundos % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Agrupación de asientos por fila
  const asientosPorFila = asientos.reduce((acc, a) => {
    if (!acc[a.fila]) acc[a.fila] = [];
    acc[a.fila].push(a);
    return acc;
  }, {} as Record<string, AsientoBackend[]>);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-2xl max-w-4xl w-full border border-gray-200 overflow-hidden my-6">
        {/* Cabecera */}
        <div className="bg-[#1F1F1F] text-white p-4 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <span className="bg-[#D31411] text-white px-2 py-0.5 rounded-sm font-black text-sm">
              TELETICKET
            </span>
            <span className="font-extrabold text-sm tracking-wide">
              PASARELA DE PAGO SEGURA · CULQI
            </span>
          </div>
          <button
            onClick={onCerrar}
            className="text-gray-400 hover:text-white font-black text-lg px-2"
          >
            ✕
          </button>
        </div>

        {/* Vista: Ticket Confirmado (Boleto Final) */}
        {entradaEmitida ? (
          <div className="p-6 text-center space-y-6 bg-gray-50">
            <div className="inline-flex items-center gap-2 bg-green-100 text-green-800 px-4 py-1.5 rounded-full text-xs font-black">
              ✓ COMPRA CONFIRMADA EXITOSAMENTE
            </div>
            
            <div className="max-w-md mx-auto bg-white border-2 border-dashed border-[#D31411] rounded-lg p-6 shadow-md text-left space-y-4">
              <div className="flex justify-between items-start border-b pb-3">
                <div>
                  <h3 className="font-black text-lg text-gray-900">{entradaEmitida.evento}</h3>
                  <p className="text-xs text-gray-500">{entradaEmitida.lugar}</p>
                </div>
                <span className="bg-[#D31411] text-white text-[10px] font-black px-2 py-1 rounded-xs">
                  E-TICKET
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-gray-400 block font-bold">ASIENTO</span>
                  <strong className="text-sm text-gray-900">{entradaEmitida.asiento}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block font-bold">ZONA</span>
                  <strong className="text-sm text-gray-900">{entradaEmitida.zona}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block font-bold">TITULAR</span>
                  <strong className="text-sm text-gray-900">{entradaEmitida.comprador}</strong>
                </div>
                <div>
                  <span className="text-gray-400 block font-bold">MONTO PAGADO</span>
                  <strong className="text-sm text-[#D31411]">S/ {entradaEmitida.monto.toFixed(2)}</strong>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-400 block font-bold">CÓDIGO DE ORDEN</span>
                  <code className="text-xs font-mono font-bold text-gray-800 bg-gray-100 px-2 py-0.5 rounded-xs">
                    {entradaEmitida.codigo}
                  </code>
                </div>
              </div>

              {/* QR Renderizado */}
              <div className="pt-2 flex flex-col items-center justify-center border-t">
                <div
                  className="w-36 h-36 flex items-center justify-center p-2 bg-white border border-gray-300 rounded-sm"
                  dangerouslySetInnerHTML={{ __html: entradaEmitida.qr }}
                />
                <span className="text-[10px] text-gray-400 pt-1 font-medium">
                  Presenta este código QR oficial en la puerta del Estadio
                </span>
              </div>
            </div>

            <div className="flex justify-center gap-3">
              <button
                onClick={() => window.print()}
                className="bg-gray-800 hover:bg-gray-900 text-white font-bold text-xs uppercase px-6 py-2.5 rounded-xs"
              >
                Imprimir E-Ticket
              </button>
              <button
                onClick={onCerrar}
                className="bg-[#D31411] hover:bg-[#b5100d] text-white font-bold text-xs uppercase px-6 py-2.5 rounded-xs"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        ) : (
          /* Vista: Mapa de Butacas y Formulario Culqi */
          <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
            {/* Columna Izquierda: Mapa de Butacas Interactivo */}
            <div className="md:col-span-7 space-y-4">
              <div className="border border-gray-200 rounded-md p-4 bg-gray-50">
                <div className="w-full bg-[#1F1F1F] text-white py-1.5 text-center text-xs font-black uppercase rounded-xs mb-4 tracking-wider">
                  ESCENARIO PRINCIPAL
                </div>

                {cargando && asientos.length === 0 ? (
                  <div className="text-center py-12 text-xs text-gray-500">
                    Cargando butacas en tiempo real...
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[360px] overflow-y-auto p-2">
                    {Object.entries(asientosPorFila).map(([fila, lista]) => (
                      <div key={fila} className="flex items-center justify-center gap-1.5">
                        <span className="w-5 text-[11px] font-bold text-gray-400 text-center">{fila}</span>
                        <div className="flex gap-1.5 flex-wrap justify-center">
                          {lista.map((a) => {
                            const esMio = a.mio || reserva?.id === a.id;
                            const ocupado = a.estado !== "libre" && !esMio;
                            return (
                              <button
                                key={a.id}
                                disabled={ocupado || (reserva !== null && !esMio)}
                                onClick={() => handleReservar(a)}
                                title={`Fila ${a.fila}, Butaca ${a.numero} - S/ ${a.precio}`}
                                className={`w-7 h-7 text-[10px] font-black rounded-xs transition-all ${
                                  esMio
                                    ? "bg-green-600 text-white shadow-md ring-2 ring-green-300"
                                    : ocupado
                                    ? "bg-gray-300 text-gray-400 cursor-not-allowed"
                                    : "bg-amber-100 text-amber-900 border border-amber-400 hover:bg-amber-500 hover:text-white"
                                }`}
                              >
                                {a.numero}
                              </button>
                            );
                          })}
                        </div>
                        <span className="w-5 text-[11px] font-bold text-gray-400 text-center">{fila}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Leyenda */}
                <div className="flex justify-center gap-4 text-[10px] font-bold pt-4 border-t border-gray-200 mt-4 text-gray-600">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-amber-100 border border-amber-400 rounded-xs"></span> Disponible
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-green-600 rounded-xs"></span> Tu Selección
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-3 bg-gray-300 rounded-xs"></span> Agotado
                  </span>
                </div>
              </div>
            </div>

            {/* Columna Derecha: Formulario Culqi */}
            <div className="md:col-span-5 space-y-4">
              {mensajeError && (
                <div className="bg-red-50 border-l-4 border-[#D31411] p-3 text-xs text-red-700 font-semibold">
                  {mensajeError}
                </div>
              )}

              {reserva ? (
                <div className="border border-gray-200 rounded-md p-4 bg-gray-50 space-y-4">
                  <div className="flex justify-between items-center border-b pb-2">
                    <div>
                      <span className="text-[10px] text-gray-500 uppercase font-bold block">BUTACA RESERVADA</span>
                      <strong className="text-base text-gray-900">{reserva.etiqueta}</strong>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-gray-500 uppercase font-bold block">TOTAL</span>
                      <strong className="text-base text-[#D31411]">S/ {reserva.precio.toFixed(2)}</strong>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-xs bg-amber-50 border border-amber-200 p-2.5 rounded-xs">
                    <span className="font-bold text-amber-800">Tiempo para pagar:</span>
                    <strong className="font-mono text-sm text-[#D31411] font-black">
                      {formatTiempo(tiempoRestante)}
                    </strong>
                  </div>

                  <form onSubmit={handlePagarCulqi} className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-600 uppercase block mb-1">
                        Nombre del Titular
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Ej. Juan Pérez"
                        value={form.comprador}
                        onChange={(e) => setForm({ ...form, comprador: e.target.value })}
                        className="w-full text-xs p-2 border border-gray-300 rounded-xs focus:border-[#D31411] outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-600 uppercase block mb-1">
                        Correo para el E-Ticket
                      </label>
                      <input
                        required
                        type="email"
                        placeholder="correo@ejemplo.com"
                        value={form.email}
                        onChange={(e) => setForm({ ...form, email: e.target.value })}
                        className="w-full text-xs p-2 border border-gray-300 rounded-xs focus:border-[#D31411] outline-hidden"
                      />
                    </div>

                    <div>
                      <label className="text-[10px] font-bold text-gray-600 uppercase block mb-1">
                        Número de Tarjeta (Culqi)
                      </label>
                      <input
                        required
                        type="text"
                        maxLength={19}
                        placeholder="4111 1111 1111 1111"
                        value={form.numero}
                        onChange={(e) => setForm({ ...form, numero: e.target.value })}
                        className="w-full text-xs p-2 border border-gray-300 rounded-xs focus:border-[#D31411] outline-hidden font-mono"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 uppercase block mb-1">
                          Vencimiento
                        </label>
                        <input
                          required
                          type="text"
                          placeholder="MM/AA"
                          maxLength={5}
                          value={form.vencimiento}
                          onChange={(e) => setForm({ ...form, vencimiento: e.target.value })}
                          className="w-full text-xs p-2 border border-gray-300 rounded-xs focus:border-[#D31411] outline-hidden text-center font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-gray-600 uppercase block mb-1">
                          CVV
                        </label>
                        <input
                          required
                          type="password"
                          maxLength={4}
                          placeholder="123"
                          value={form.cvv}
                          onChange={(e) => setForm({ ...form, cvv: e.target.value })}
                          className="w-full text-xs p-2 border border-gray-300 rounded-xs focus:border-[#D31411] outline-hidden text-center font-mono"
                        />
                      </div>
                    </div>

                    <div className="pt-2 space-y-2">
                      <button
                        type="submit"
                        disabled={procesandoPago}
                        className="w-full bg-[#00A859] hover:bg-[#008f4c] text-white font-extrabold text-xs uppercase py-3 rounded-xs shadow-md transition-all flex items-center justify-center gap-2"
                      >
                        {procesandoPago ? (
                          <span>Procesando pago con Culqi...</span>
                        ) : (
                          <span>Pagar S/ {reserva.precio.toFixed(2)} con Culqi</span>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleCancelarReserva}
                        disabled={procesandoPago}
                        className="w-full bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold text-xs uppercase py-2 rounded-xs"
                      >
                        Liberar Butaca
                      </button>
                    </div>
                  </form>
                </div>
              ) : (
                <div className="border border-dashed border-gray-300 rounded-md p-6 text-center space-y-2 text-gray-500">
                  <svg className="w-10 h-10 mx-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                  </svg>
                  <h4 className="font-bold text-sm text-gray-700">Elige una butaca libre</h4>
                  <p className="text-xs">
                    Selecciona un asiento disponible en el mapa de la izquierda para congelar su reserva e ingresar los datos de pago con Culqi.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

