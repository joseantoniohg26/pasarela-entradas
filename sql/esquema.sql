CREATE TABLE IF NOT EXISTS eventos (
    id      SERIAL PRIMARY KEY,
    nombre  TEXT NOT NULL,
    lugar   TEXT NOT NULL,
    fecha   TIMESTAMPTZ NOT NULL
);

-- Datos para la vitrina (catálogo y página de detalle). Se agregan con ALTER
-- para que una base creada antes también los tenga.
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS categoria   TEXT NOT NULL DEFAULT 'Concierto';
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS artista     TEXT NOT NULL DEFAULT '';
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS descripcion TEXT NOT NULL DEFAULT '';
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS imagen      TEXT NOT NULL DEFAULT '';
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS afiche_url  TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS asientos (
    id               SERIAL PRIMARY KEY,
    evento_id        INT NOT NULL REFERENCES eventos(id),
    fila             TEXT NOT NULL,
    numero           INT NOT NULL,
    precio           NUMERIC(10, 2) NOT NULL,
    zona             TEXT NOT NULL DEFAULT '',
    estado           TEXT NOT NULL DEFAULT 'libre'
                     CHECK (estado IN ('libre', 'reservado', 'vendido')),
    reservado_por    TEXT,
    reservado_hasta  TIMESTAMPTZ,
    UNIQUE (evento_id, fila, numero)
);

ALTER TABLE asientos ADD COLUMN IF NOT EXISTS zona       TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_asientos_evento ON asientos (evento_id);
CREATE INDEX IF NOT EXISTS idx_asientos_cliente ON asientos (reservado_por);

CREATE TABLE IF NOT EXISTS ordenes (
    id                SERIAL PRIMARY KEY,
    codigo            TEXT NOT NULL UNIQUE,
    asiento_id        INT NOT NULL REFERENCES asientos(id),
    comprador         TEXT NOT NULL,
    email             TEXT NOT NULL,
    monto             NUMERIC(10, 2) NOT NULL,
    tarjeta_ultimos4  CHAR(4) NOT NULL,
    cargo_id          TEXT NOT NULL,
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Momento en que la entrada fue validada en la puerta (NULL = sin usar)
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS usado_en TIMESTAMPTZ;

-- Segunda barrera contra la sobreventa: un asiento solo puede tener una orden
CREATE UNIQUE INDEX IF NOT EXISTS uq_orden_por_asiento ON ordenes (asiento_id);
