import { useEffect, useState } from "react";

const TIENDA = "http://127.0.0.1:8000";

// Lo que devuelve GET /api/eventos del backend
type Evento = {
  id: number;
  nombre: string;
  artista: string;
  categoria: string;
  lugar: string;
  fecha: string;
  imagen: string;
  descripcion: string;
  aforo: number;
  disponibles: number;
  precio_desde: number | null;
};

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", { dateStyle: "full", timeStyle: "short" });
}

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-PE", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const soles = (valor: number): string => "S/ " + valor.toFixed(2);

const ETIQUETA =
  "inline-block rounded-full border px-2.5 py-1 text-[.68rem] font-bold uppercase tracking-[.14em]";

function Destacado({ evento }: { evento: Evento }) {
  return (
    <section
      className="relative flex min-h-[580px] items-end bg-superficie-2 bg-cover bg-[center_30%]"
      style={{ backgroundImage: `url('/img/${evento.imagen}')` }}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-fondo via-fondo/80 to-fondo/15" />
      <div className="relative z-10 mx-auto w-full max-w-[1760px] px-10 py-14">
        <span className={`${ETIQUETA} border-acento/35 bg-acento/20 text-acento-claro`}>
          {evento.categoria}
        </span>
        <h1 className="mt-5 mb-2.5 max-w-[780px] text-6xl leading-[1.05] font-bold">
          {evento.nombre}
        </h1>
        <p className="text-lg font-semibold text-oro">{evento.artista}</p>
        <p className="mt-3 mb-7 text-suave">
          {evento.lugar} · {fechaLarga(evento.fecha)}
        </p>
        <a
          className="inline-block rounded-[10px] bg-acento px-7 py-3.5 font-semibold text-white transition-colors hover:bg-acento-oscuro"
          href={`${TIENDA}/#/comprar/${evento.id}`}
        >
          Comprar entradas
        </a>
      </div>
    </section>
  );
}

function TarjetaEvento({ evento }: { evento: Evento }) {
  const agotado = evento.disponibles === 0;
  return (
    <a
      className="block overflow-hidden rounded-[14px] border border-borde bg-superficie transition hover:-translate-y-1 hover:border-[#453c5c]"
      href={`${TIENDA}/#/evento/${evento.id}`}
    >
      <div
        className="relative aspect-3/4 bg-superficie-2 bg-cover bg-center"
        style={{ backgroundImage: `url('/img/${evento.imagen}')` }}
      >
        <span className={`${ETIQUETA} absolute top-3 left-3 border-white/20 bg-fondo/80 text-texto`}>
          {evento.categoria}
        </span>
        {agotado && (
          <div className="absolute inset-0 grid place-items-center bg-fondo/70 text-sm font-bold tracking-[.18em]">
            AGOTADO
          </div>
        )}
      </div>
      <div className="px-5 pt-4.5 pb-5.5">
        <p className="text-[.72rem] font-bold tracking-[.1em] uppercase text-acento-claro">
          {fechaCorta(evento.fecha)}
        </p>
        <h3 className="mt-2 mb-1 text-lg leading-snug font-semibold">{evento.nombre}</h3>
        <p className="text-sm text-suave">{evento.lugar}</p>
        <p className="mt-3.5 text-sm text-suave">
          Desde{" "}
          <strong className="text-xl text-texto">
            {evento.precio_desde === null ? "–" : soles(evento.precio_desde)}
          </strong>
        </p>
      </div>
    </a>
  );
}

export default function App() {
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/eventos")
      .then((r) => {
        if (!r.ok) throw new Error("El servidor respondió " + r.status);
        return r.json() as Promise<Evento[]>;
      })
      .then(setEventos)
      .catch(() =>
        setError("No se pudo conectar con el backend. ¿Está levantado en el puerto 8000?"),
      );
  }, []);

  if (error) return <p className="px-6 py-20 text-center text-suave">{error}</p>;
  if (eventos.length === 0)
    return <p className="px-6 py-20 text-center text-suave">Cargando cartelera…</p>;

  return (
    <>
      <header className="flex items-center gap-7 border-b border-borde bg-fondo/90 px-10 py-3.5">
        <span className="font-extrabold tracking-[.16em]">
          TIQUE<span className="text-acento">TERA</span>
        </span>
        <nav className="text-sm text-suave">
          <a className="hover:text-texto" href={TIENDA}>
            Versión completa
          </a>
        </nav>
        <span className="ml-auto rounded-full border border-borde px-2.5 py-1 text-[.72rem] text-suave">
          React + TypeScript + Tailwind
        </span>
      </header>

      <p className="border-b border-oro/20 bg-oro/10 px-6 py-2.5 text-center text-[.78rem] text-oro">
        Prototipo académico · Calidad Aplicada a los Sistemas de Información (UNAMAD) · Aquí no se
        venden entradas reales ni se cobran pagos
      </p>

      <Destacado evento={eventos[0]} />

      <main className="mx-auto w-full max-w-[1760px] px-10 pt-7 pb-16">
        <h2 className="mt-12 mb-5 text-2xl tracking-wide font-semibold">Próximos eventos</h2>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-7">
          {eventos.map((evento) => (
            <TarjetaEvento key={evento.id} evento={evento} />
          ))}
        </div>
      </main>

      <footer className="border-t border-borde px-10 py-5 text-center text-[.78rem] text-suave">
        Los datos salen de la misma API que usa la versión en HTML: este frontend solo consume{" "}
        <code className="text-oro">/api/eventos</code>.
      </footer>
    </>
  );
}
