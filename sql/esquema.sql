-- Esquema oficial para Paulo Londra - Estadio Nacional 2026 (Teleticket)

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
    zona             TEXT NOT NULL DEFAULT 'Campo A',
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

-- 1. Insertar el único concierto: Paulo Londra 2026
INSERT INTO eventos (id, nombre, artista, categoria, lugar, fecha, afiche_url, imagen, descripcion)
VALUES (
    1,
    'PAULO LONDRA · TOUR 2026',
    'Paulo Londra',
    'Urbano / Trap',
    'Estadio Nacional, Lima',
    '2026-08-29 21:00:00-05',
    '/img/concierto-internacional.svg',
    'concierto-internacional.svg',
    'El deseo de miles de fanáticos finalmente se hace realidad: Paulo Londra remecerá el Estadio Nacional este sábado 29 de agosto de 2026. Organiza: CONCERTS SPORTS AEI10 S.A.C. Preventa con hasta 15% de descuento Interbank. Máximo 6 entradas por cliente.'
)
ON CONFLICT (id) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    artista = EXCLUDED.artista,
    categoria = EXCLUDED.categoria,
    lugar = EXCLUDED.lugar,
    fecha = EXCLUDED.fecha,
    descripcion = EXCLUDED.descripcion;

-- 2. Eliminar eventos sobrantes si existían para dejar únicamente a Paulo Londra
DELETE FROM eventos WHERE id <> 1;

-- 3. Generar la distribución oficial de sectores y butacas según tarifas de Teleticket
-- Precios oficiales Preventa:
-- Campo A: S/ 270.00
-- Campo B: S/ 125.00
-- Tribuna Occidente 1: S/ 185.00
-- Tribuna Occidente 2: S/ 160.00
-- Tribuna Oriente 1: S/ 185.00
-- Tribuna Oriente 2: S/ 160.00
-- Tribuna Norte: S/ 80.00
DO $$
DECLARE
    f INT;
    n INT;
    letra TEXT;
    z TEXT;
    p NUMERIC;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM asientos WHERE evento_id = 1) THEN
        -- Filas A a B: Campo A (S/ 270.00)
        FOR f IN 0..1 LOOP
            letra := chr(65 + f);
            FOR n IN 1..20 LOOP
                INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
                VALUES (1, letra, n, 270.00, 'Campo A', 'libre');
            END LOOP;
        END LOOP;

        -- Filas C a D: Campo B (S/ 125.00)
        FOR f IN 2..3 LOOP
            letra := chr(65 + f);
            FOR n IN 1..20 LOOP
                INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
                VALUES (1, letra, n, 125.00, 'Campo B', 'libre');
            END LOOP;
        END LOOP;

        -- Fila E: Tribuna Occidente 1 (S/ 185.00)
        FOR n IN 1..20 LOOP
            INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
            VALUES (1, 'OCC-1', n, 185.00, 'Occidente 1', 'libre');
        END LOOP;

        -- Fila F: Tribuna Occidente 2 (S/ 160.00)
        FOR n IN 1..20 LOOP
            INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
            VALUES (1, 'OCC-2', n, 160.00, 'Occidente 2', 'libre');
        END LOOP;

        -- Fila G: Tribuna Oriente 1 (S/ 185.00)
        FOR n IN 1..20 LOOP
            INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
            VALUES (1, 'ORI-1', n, 185.00, 'Oriente 1', 'libre');
        END LOOP;

        -- Fila H: Tribuna Oriente 2 (S/ 160.00)
        FOR n IN 1..20 LOOP
            INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
            VALUES (1, 'ORI-2', n, 160.00, 'Oriente 2', 'libre');
        END LOOP;

        -- Fila I: Tribuna Norte (S/ 80.00)
        FOR n IN 1..20 LOOP
            INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
            VALUES (1, 'NORTE', n, 80.00, 'Tribuna Norte', 'libre');
        END LOOP;
    END IF;
END $$;
