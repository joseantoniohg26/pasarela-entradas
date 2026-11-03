-- Esquema inicial de tablas
CREATE TABLE IF NOT EXISTS eventos (
    id          SERIAL PRIMARY KEY,
    nombre      TEXT NOT NULL,
    lugar       TEXT NOT NULL,
    fecha       TIMESTAMPTZ NOT NULL,
    categoria   TEXT NOT NULL DEFAULT 'Concierto',
    artista     TEXT NOT NULL DEFAULT '',
    descripcion TEXT NOT NULL DEFAULT '',
    afiche_url  TEXT NOT NULL DEFAULT '',
    imagen      TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS asientos (
    id               SERIAL PRIMARY KEY,
    evento_id        INT NOT NULL REFERENCES eventos(id),
    fila             TEXT NOT NULL,
    numero           INT NOT NULL,
    precio           NUMERIC(10, 2) NOT NULL,
    zona             TEXT NOT NULL DEFAULT 'General',
    estado           TEXT NOT NULL DEFAULT 'libre'
                     CHECK (estado IN ('libre', 'reservado', 'vendido')),
    reservado_por    TEXT,
    reservado_hasta  TIMESTAMPTZ,
    UNIQUE (evento_id, fila, numero)
);

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
    cargo_id          TEXT NOT NULL DEFAULT '',
    creado_en         TIMESTAMPTZ NOT NULL DEFAULT now(),
    usado_en          TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_orden_por_asiento ON ordenes (asiento_id);

-- Sembrado inicial de eventos si la tabla está vacía
INSERT INTO eventos (id, nombre, artista, categoria, lugar, fecha, afiche_url, imagen, descripcion)
VALUES 
(1, 'BTS · WORLD TOUR ''LIGHTS'' LIMA 2026', 'BTS', 'K-Pop', 'Estadio Nacional, Lima', '2026-12-15 20:00:00-05', '/img/concierto-internacional.svg', 'concierto-internacional.svg', 'El concierto más esperado de la década en Lima. Preventa exclusiva.'),
(2, 'Grupo 5 · 52 Años de Oro', 'Grupo 5', 'Cumbia', 'Estadio San Marcos, Lima', '2026-12-28 21:00:00-05', '/img/grupo5.jpg', 'grupo5.jpg', 'Celebración oficial de aniversario con orquesta completa.'),
(3, 'Libido en Concierto: La Reunión', 'Libido', 'Rock', 'Arena 1, Costa Verde', '2027-01-20 20:30:00-05', '/img/libido.jpg', 'libido.jpg', 'La formación original reunida tras dos décadas.')
ON CONFLICT (id) DO NOTHING;

-- Generar asientos para el evento 1 (BTS) de forma automática con SQL puro
DO $$
DECLARE
    f INT;
    n INT;
    letra TEXT;
    z TEXT;
    p NUMERIC;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM asientos WHERE evento_id = 1) THEN
        FOR f IN 0..9 LOOP
            letra := chr(65 + f);
            FOR n IN 1..20 LOOP
                IF f < 2 THEN
                    z := 'VIP'; p := 450.00;
                ELSIF f < 5 THEN
                    z := 'Preferencial'; p := 280.00;
                ELSE
                    z := 'General'; p := 150.00;
                END IF;

                INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
                VALUES (1, letra, n, p, z, 'libre');
            END LOOP;
        END LOOP;
    END IF;
END $$;
