-- Inicialización y siembra de evento y asientos para Paulo Londra 2026
DO $$
BEGIN
    -- 1. Columnas adicionales si no existían
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS categoria TEXT NOT NULL DEFAULT 'Concierto';
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS artista TEXT NOT NULL DEFAULT '';
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS descripcion TEXT NOT NULL DEFAULT '';
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS imagen TEXT NOT NULL DEFAULT '';
    ALTER TABLE eventos ADD COLUMN IF NOT EXISTS afiche_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE asientos ADD COLUMN IF NOT EXISTS zona TEXT NOT NULL DEFAULT '';

    -- 2. Asegurar el evento principal Paulo Londra
    INSERT INTO eventos (id, nombre, artista, categoria, lugar, fecha, afiche_url, imagen, descripcion)
    VALUES (1, 'PAULO LONDRA · TOUR 2026', 'Paulo Londra', 'Urbano / Trap', 'Estadio Nacional, Lima', '2026-08-29 21:00:00-05', '/img/concierto-internacional.svg', 'concierto-internacional.svg', 'El deseo de miles de fanáticos se hace realidad: Paulo Londra en el Estadio Nacional este sábado 29 de agosto de 2026. Organiza: CONCERTS SPORTS AEI10 S.A.C. Preventa con hasta 15% de descuento Interbank. Máximo 6 entradas por cliente.')
    ON CONFLICT (id) DO UPDATE SET
        nombre = EXCLUDED.nombre,
        artista = EXCLUDED.artista,
        categoria = EXCLUDED.categoria,
        lugar = EXCLUDED.lugar,
        fecha = EXCLUDED.fecha,
        descripcion = EXCLUDED.descripcion,
        afiche_url = EXCLUDED.afiche_url;

    -- 3. Sectores oficiales de Paulo Londra
    -- Campo A (40 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'A', s, 270.00, 'Campo A', 'libre' FROM generate_series(1, 40) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Campo B (40 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'B', s, 125.00, 'Campo B', 'libre' FROM generate_series(1, 40) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Occidente 1 (30 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'OCC-1', s, 185.00, 'Occidente 1', 'libre' FROM generate_series(1, 30) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Occidente 2 (30 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'OCC-2', s, 160.00, 'Occidente 2', 'libre' FROM generate_series(1, 30) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Oriente 1 (30 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'ORI-1', s, 185.00, 'Oriente 1', 'libre' FROM generate_series(1, 30) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Oriente 2 (30 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'ORI-2', s, 160.00, 'Oriente 2', 'libre' FROM generate_series(1, 30) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Tribuna Norte (40 asientos)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'NORTE', s, 80.00, 'Tribuna Norte', 'libre' FROM generate_series(1, 40) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Asientos adicionales para pruebas de alta concurrencia k6 (200 VUs)
    INSERT INTO asientos (evento_id, fila, numero, precio, zona, estado)
    SELECT 1, 'GEN-' || chr(65 + f), s, 100.00, 'General Extra', 'libre'
    FROM generate_series(0, 9) f, generate_series(1, 60) s
    ON CONFLICT (evento_id, fila, numero) DO NOTHING;

    -- Limpiar reservas previas para dejar todo libre
    UPDATE asientos SET estado = 'libre', reservado_por = NULL, reservado_hasta = NULL WHERE evento_id = 1;
END $$;
