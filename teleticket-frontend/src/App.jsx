import { useEffect, useState } from "react";
import "./App.css";

const TIENDA = "http://127.0.0.1:8000";

function fechaLarga(iso) {
  return new Date(iso).toLocaleString("es-PE", { dateStyle: "full", timeStyle: "short" });
}

function fechaCorta(iso) {
  return new Date(iso).toLocaleString("es-PE", {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

const soles = (valor) => "S/ " + valor.toFixed(2);

function Destacado({ evento }) {
  return (
    <article className="destacado" style={{ backgroundImage: `url('/img/${evento.imagen}')` }}>
      <div className="destacado-texto">
        <span className="etiqueta">{evento.categoria}</span>
        <h1>{evento.nombre}</h1>
        <p className="artista">{evento.artista}</p>
        <p className="datos">{evento.lugar} · {fechaLarga(evento.fecha)}</p>
        <a className="boton" href={`${TIENDA}/#/comprar/${evento.id}`}>Comprar entradas</a>
      </div>
    </article>
  );
}

function TarjetaEvento({ evento }) {
  const agotado = evento.disponibles === 0;
  return (
    <a className="tarjeta-evento" href={`${TIENDA}/#/evento/${evento.id}`}>
      <div className="afiche" style={{ backgroundImage: `url('/img/${evento.imagen}')` }}>
        <span className="etiqueta">{evento.categoria}</span>
        {agotado && <div className="agotado">AGOTADO</div>}
      </div>
      <div className="datos-evento">
        <p className="fecha">{fechaCorta(evento.fecha)}</p>
        <h3>{evento.nombre}</h3>
        <p className="lugar">{evento.lugar}</p>
        <p className="desde">
          Desde <strong>{evento.precio_desde === null ? "–" : soles(evento.precio_desde)}</strong>
        </p>
      </div>
    </a>
  );
}

export default function App() {
  const [eventos, setEventos] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/eventos")
      .then((r) => {
        if (!r.ok) throw new Error("El servidor respondió " + r.status);
        return r.json();
      })
      .then(setEventos)
      .catch(() => setError("No se pudo conectar con el backend. ¿Está levantado en el puerto 8000?"));
  }, []);

  if (error) return <p className="aviso">{error}</p>;
  if (eventos.length === 0) return <p className="aviso">Cargando cartelera…</p>;

  return (
    <>
      <header className="cabecera">
        <span className="marca">TIQUE<span>TERA</span></span>
        <nav>
          <a href={TIENDA}>Versión completa</a>
        </nav>
        <span className="modo">frontend en React</span>
      </header>

      <p className="aviso-demo">
        Prototipo académico · Calidad Aplicada a los Sistemas de Información (UNAMAD) ·
        Aquí no se venden entradas reales ni se cobran pagos
      </p>

      <Destacado evento={eventos[0]} />

      <main>
        <h2 className="titulo-seccion">Próximos eventos</h2>
        <div className="rejilla">
          {eventos.map((evento) => <TarjetaEvento key={evento.id} evento={evento} />)}
        </div>
      </main>

      <footer className="pie">
        Los datos salen de la misma API que usa la versión en HTML: este frontend solo
        consume <code>/api/eventos</code>.
      </footer>
    </>
  );
}
