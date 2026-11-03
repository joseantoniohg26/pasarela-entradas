import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// El frontend corre en el puerto 5173 y el backend en el 8000. Para que el
// navegador no bloquee las peticiones por ser de distinto origen, Vite las
// reenvía: todo lo que empiece con /api y /img va al servidor de Python.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/img": "http://127.0.0.1:8000",
      "/simulador-pasarela": "http://127.0.0.1:8000",
    },
  },
});
