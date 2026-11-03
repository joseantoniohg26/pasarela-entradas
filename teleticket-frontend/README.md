# Frontend en React + TypeScript + Tailwind

Versión del catálogo hecha con **React 19, TypeScript y Tailwind CSS 4**, que
consume **la misma API** que la página en HTML. Sirve para mostrar que el
backend está desacoplado de la interfaz: el mismo `/api/eventos` alimenta las
dos.

## Cómo levantarlo

Necesita el backend encendido en el puerto 8000. En una terminal:

```powershell
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Y en otra:

```powershell
cd teleticket-frontend
npm install     # solo la primera vez
npm run dev
```

Queda en **http://localhost:5173** (con `localhost`, no con `127.0.0.1`: Vite
escucha en IPv6).

## Cómo está armado

| Pieza | Dónde |
|---|---|
| Tipos de los datos de la API | `type Evento` en `src/App.tsx` |
| Colores de la marca | bloque `@theme` en `src/index.css` |
| Reenvío al backend | `vite.config.ts` |

Tailwind 4 se configura desde el CSS, no con `tailwind.config.js`. Los colores
declarados en `@theme` se usan como utilidades: `bg-fondo`, `text-oro`,
`border-borde`.

Vite reenvía al servidor de Python todo lo que empiece con `/api`, `/img` y
`/simulador-pasarela`. Sin eso el navegador bloquearía las peticiones por venir
de un puerto distinto.

## Qué hace y qué no

| | |
|---|---|
| Cartelera con el evento destacado y la rejilla | sí |
| Detalle, sala de espera, mapa de butacas, pago y QR | **no** |

El botón "Comprar entradas" lleva a la versión completa en el puerto 8000. Esta
carpeta es un punto de partida para migrar el frontend, no un reemplazo.

## Si `npm run build` falla

Es un problema conocido de npm con las dependencias opcionales
([npm#4828](https://github.com/npm/cli/issues/4828)): no instala los binarios
nativos de Rolldown y Tailwind. Se arregla así:

```powershell
npm install @rolldown/binding-win32-x64-msvc @tailwindcss/oxide-win32-x64-msvc --no-save
```

## Aviso de versión de Node

El proyecto pide Node 20.19+ o 22.12+. Con Node 20.17 funciona igual, pero Vite
muestra un aviso al arrancar.
