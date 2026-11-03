# Frontend en React

Versión del catálogo hecha con React + Vite, que consume **la misma API** que la
página en HTML. Sirve para mostrar que el backend está desacoplado de la
interfaz: el mismo `/api/eventos` alimenta las dos.

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

## Cómo se conecta con el backend

Vite reenvía al servidor de Python todo lo que empiece con `/api`, `/img` y
`/simulador-pasarela`, según `vite.config.js`. Sin eso el navegador bloquearía
las peticiones por venir de un puerto distinto.

## Qué hace y qué no

| | |
|---|---|
| Cartelera con el evento destacado y la rejilla | sí |
| Detalle, sala de espera, mapa de butacas, pago y QR | **no** |

El botón "Comprar entradas" lleva a la versión completa en el puerto 8000. Esta
carpeta es un punto de partida para migrar el frontend, no un reemplazo.

## Si `npm run build` falla

Es un problema conocido de npm con las dependencias opcionales
([npm#4828](https://github.com/npm/cli/issues/4828)): no instala el binario
nativo. Se arregla así:

```powershell
rm -r node_modules, package-lock.json
npm install
npm install @rolldown/binding-win32-x64-msvc --no-save
```
