# Pruebas desde Ubuntu

El docente confirmó que **Ubuntu es para las pruebas**, no para todo el sistema:
la aplicación se queda en Windows y Ubuntu actúa como el cliente que la ataca
con herramientas de software libre. Eso es exactamente lo que ya está armado.

```
   WINDOWS (anfitrión)                 UBUNTU 24.04 (VirtualBox, red NAT)
   ───────────────────                 ──────────────────────────────────
   uvicorn  :8000  (HTTP)   <────────  k6            (carga, RNF-01/02)
   uvicorn  :8443  (HTTPS)  <────────  testssl.sh    (cifrado, RNF-04)
   PostgreSQL 18                       OWASP ZAP     (seguridad web)
                                       python3       (sobreventa, bots)

   Desde Ubuntu, el Windows se ve como 10.0.2.2
```

---

## Paso 0 · La máquina virtual

**No hay que instalar nada:** la VM `Ubuntu24-04` ya existe y ya tiene Ubuntu
24.04 instalado (su disco virtual ocupa 15 GB reales). Se enciende con doble
clic desde VirtualBox.

Su configuración, ya verificada:

| Ajuste | Valor | Para qué sirve |
|---|---|---|
| Red | **NAT** con `localhost-reachable` activado | La VM ve al Windows como `10.0.2.2` |
| Memoria | 8 GB | De sobra para las pruebas |
| Procesadores | 4 | Suficiente para generar carga |

El ajuste `localhost-reachable` es el importante: gracias a él, desde Ubuntu se
alcanza el servidor de Windows **aunque este escuche solo en `127.0.0.1`**, sin
tocar el cortafuegos y sin cambiar cómo se levanta el servidor.

### Comprobar que se ven las dos máquinas

En **Windows**, levantar el servidor como siempre:

```powershell
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

En **Ubuntu**, abrir una terminal (Ctrl + Alt + T) y escribir:

```bash
curl http://10.0.2.2:8000/api/config
curl -k https://10.0.2.2:8443/api/config
```

Las dos tienen que responder `{"modo":"sala",...}`. El `-k` del segundo es
porque el certificado es autofirmado.

> **Si diera `Connection refused`** (no debería, por lo del `localhost-reachable`):
> levantar el servidor en Windows con `--host 0.0.0.0 --port 8000` y permitir el
> aviso del cortafuegos en redes privadas.

También conviene confirmar que la VM tiene internet, porque el paso 2 instala
herramientas:

```bash
ping -c 3 8.8.8.8
```

## Paso 1 · Llevar los scripts de prueba a Ubuntu

Sin instalar nada ni configurar carpetas compartidas: se usa un servidor de
archivos temporal. En **Windows**, en una terminal aparte:

```powershell
cd pruebas
..\.venv\Scripts\python -m http.server 8080
```

En **Ubuntu**:

```bash
mkdir -p ~/pasarela/pruebas ~/evidencias
cd ~/pasarela/pruebas
wget http://10.0.2.2:8080/latencia.py http://10.0.2.2:8080/bots.py \
     http://10.0.2.2:8080/sobreventa.py http://10.0.2.2:8080/carga.js
```

Después se cierra ese servidor con `Ctrl + C` (solo servía para copiar).

---

## Paso 2 · Instalar las herramientas en Ubuntu

La VM necesita internet para esto (con red NAT ya lo tiene). `latencia.py` y
`bots.py` **no necesitan nada**: usan solo la librería estándar de Python 3,
que Ubuntu 24.04 ya trae.

```bash
# Para sobreventa.py, que sí usa httpx
sudo apt update && sudo apt install -y python3-httpx

# k6 (carga)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
     --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
     | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt update && sudo apt install -y k6
k6 version

# testssl.sh (cifrado). Se usa la rama 3.2, que es la estable
git clone --depth 1 --branch 3.2 https://github.com/testssl/testssl.sh.git ~/testssl.sh
~/testssl.sh/testssl.sh --version

# OWASP ZAP
sudo snap install zaproxy --classic
zaproxy -version
```

> Si `snap install zaproxy` no funciona, está la alternativa con Docker más
> abajo, en el paso 6.

---

## Paso 3 · RNF-03: sobreventa = 0 %

En **Windows**, el servidor tiene que estar sin limitador (todas las peticiones
vienen de una sola IP) y en modo inseguro para la primera parte:

```powershell
$env:ANTIBOTS = "0"; $env:MODO_RESERVA = "inseguro"; .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

En **Ubuntu**:

```bash
python3 ~/pasarela/pruebas/sobreventa.py --url http://10.0.2.2:8000 --clientes 300 \
  | tee ~/evidencias/rnf03-inseguro.txt
```

Esperado: **varios clientes ganan la misma butaca** (en Windows dio 5 de 300).

Ahora en **Windows**, `Ctrl + C` y el modo final:

```powershell
$env:ANTIBOTS = "0"; $env:MODO_RESERVA = "sala"; .venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Antes de repetir, liberar el aforo (en Windows, otra terminal):

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
```

Y en **Ubuntu**, el mismo comando de antes:

```bash
python3 ~/pasarela/pruebas/sobreventa.py --url http://10.0.2.2:8000 --clientes 300 \
  | tee ~/evidencias/rnf03-sala.txt
```

Esperado: **1 reservado, 299 rechazados. Sobreventa = 0 %.**

---

## Paso 4 · RNF-02: tiempo de reserva ≤ 300 ms

Con el servidor en `sala` + `ANTIBOTS=0`. Reiniciar el aforo entre corridas.

```bash
# Peor caso: todas las reservas en el mismo instante
python3 ~/pasarela/pruebas/latencia.py --url http://10.0.2.2:8000 --clientes 100 \
  | tee ~/evidencias/rnf02-rafaga.txt

# Caso real: al ritmo que admite la sala de espera
python3 ~/pasarela/pruebas/latencia.py --url http://10.0.2.2:8000 --clientes 100 --ritmo 50 \
  | tee ~/evidencias/rnf02-ritmo.txt

# Contención: todos contra la misma butaca
python3 ~/pasarela/pruebas/latencia.py --url http://10.0.2.2:8000 --clientes 150 --mismo-asiento \
  | tee ~/evidencias/rnf02-contencion.txt
```

### Lo mismo con k6 (la herramienta que figura en el PPT)

```bash
cd ~/pasarela
k6 run -e BASE=http://10.0.2.2:8000 pruebas/carga.js | tee ~/evidencias/rnf02-k6.txt
```

k6 falla solo si el p95 de la reserva pasa de 300 ms, porque esa condición está
escrita dentro del script (`reserva_ms: ["p(95)<300"]`). Esa línea en la salida
de k6 es la evidencia más directa del RNF-02.

### El trade-off

Repetir las dos primeras corridas con el servidor en `MODO_RESERVA=directo` y
comparar. En Windows dieron prácticamente lo mismo, y la explicación está en el
README: PostgreSQL serializa las escrituras sobre una misma fila en los dos
casos.

---

## Paso 5 · RNF-05: bloqueo de bots

Esta prueba necesita el limitador **encendido**, al revés que las anteriores.
En **Windows**:

```powershell
.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

(sin variables de entorno: toma `ANTIBOTS=1` del `.env`)

En **Ubuntu**:

```bash
python3 ~/pasarela/pruebas/bots.py --url http://10.0.2.2:8000 --peticiones 4000 \
  | tee ~/evidencias/rnf05-bots.txt
```

Las cuatro comprobaciones deben salir `CUMPLE`. Para la cifra grande del PPT:

```bash
python3 ~/pasarela/pruebas/bots.py --url http://10.0.2.2:8000 --peticiones 30000 \
  | tee ~/evidencias/rnf05-rafaga-grande.txt
```

---

## Paso 6 · RNF-04: cifrado y seguridad web

### testssl.sh contra el puerto HTTPS

```bash
cd ~/testssl.sh
./testssl.sh --warnings off 10.0.2.2:8443 | tee ~/evidencias/rnf04-testssl.txt

# La misma prueba dejando un informe en HTML (queda en la carpeta actual)
./testssl.sh --warnings off --html 10.0.2.2:8443
```

Qué buscar en la salida, que es la evidencia del RNF-04:

- `TLS 1.3   offered (OK)`
- `TLS 1.2   not offered` y lo mismo para TLS 1.1 y 1.0 → el servidor acepta
  **solo** TLS 1.3.
- En la sección del certificado va a avisar que es autofirmado. **Eso es
  esperado y se explica**: un certificado firmado por una autoridad reconocida
  necesita un dominio público, que un prototipo de curso no tiene.

El puerto 8000 no se escanea con testssl.sh: es HTTP sin cifrar a propósito,
porque ahí se hacen las pruebas de carga.

### OWASP ZAP contra la aplicación

```bash
mkdir -p ~/evidencias
zaproxy -cmd -quickurl http://10.0.2.2:8000 -quickprogress \
        -quickout /home/$USER/evidencias/zap-http.html
```

El informe HTML se abre con el navegador de Ubuntu. Es un escaneo **activo**:
está bien hacerlo contra un sistema propio, que es este caso.

Si `zaproxy` no quedó instalado por snap, la alternativa con Docker:

```bash
sudo apt install -y docker.io && sudo usermod -aG docker $USER   # y reiniciar sesión
cd ~/evidencias
sudo docker run -v $(pwd):/zap/wrk/:rw -t ghcr.io/zaproxy/zaproxy:stable \
     zap-baseline.py -t http://10.0.2.2:8000 -r zap-baseline.html
```

El escaneo *baseline* es pasivo y más rápido; termina con código 2 cuando
encontró avisos, lo cual es normal y no significa que haya fallado.

Hallazgos que ZAP va a reportar casi seguro, y cómo responderlos:

| Hallazgo de ZAP | Respuesta |
|---|---|
| Falta `Content-Security-Policy` | Cierto; en producción lo pone el servidor web o el WAF que está delante |
| Falta `Strict-Transport-Security` (HSTS) | A propósito: HSTS dejaría inservible el puerto 8000 que usamos para medir carga (explicado en el README) |
| Falta `X-Content-Type-Options` | Mismo caso que CSP |
| Cookies sin `Secure` | No usamos cookies: la sesión va en cabeceras `X-Pase` / `X-Sesion` |

Que ZAP encuentre cosas no es un problema para la exposición: lo que se evalúa
es que sepas **qué encontró, por qué pasa y qué harías en producción**.

---

## Paso 7 · Guardar las evidencias

Todas las corridas con `tee` ya dejan su salida en `~/evidencias/`. Conviene
además una captura de pantalla de:

1. La terminal de Ubuntu con el resultado de `sobreventa.py` en modo `sala`
   (**1 reservado, 299 rechazados**).
2. La línea de k6 con el `p(95)` de `reserva_ms`.
3. La sección de protocolos de testssl.sh (`TLS 1.3 offered`).
4. El informe HTML de ZAP abierto en el navegador.
5. El panel de administración de Windows con los contadores moviéndose mientras
   corre una prueba desde Ubuntu — esa imagen muestra las dos máquinas
   trabajando juntas y es la que mejor explica el montaje.

Para llevar las evidencias de vuelta a Windows, el mismo truco del paso 1 pero
al revés, desde Ubuntu:

```bash
cd ~/evidencias && python3 -m http.server 8080
```

y en Windows, en el navegador: `http://<IP-de-la-VM>:8080` (la IP se ve con
`ip a` en Ubuntu). Con red NAT puede no ser alcanzable; en ese caso lo más
simple es copiar y pegar el texto, o pasar los archivos por una carpeta
compartida de VirtualBox.

---

## Si algo falla

| Problema | Causa y solución |
|---|---|
| `Connection refused` a 10.0.2.2:8000 | Revisar que el servidor esté levantado en Windows; si sigue, levantarlo con `--host 0.0.0.0` |
| Responde pero todo da 429 | Falta `$env:ANTIBOTS = "0"` en la terminal del servidor de Windows |
| `bots.py` dice "Antibots: DESACTIVADO" | Al revés: levantar el servidor **sin** variables de entorno |
| `No quedan asientos libres` | En Windows: `iniciar_bd.py --reiniciar --filas 20 --por-fila 25` |
| k6: `dial tcp ... connect: connection refused` | Mismo caso que la primera fila |
| testssl.sh no encuentra el puerto | Hay que escribir `10.0.2.2:8443`; sin el puerto asume 443 |
| ZAP no abre nada | Está corriendo en modo consola (`-cmd`); el resultado queda en el archivo HTML |
| La VM no tiene internet | Revisar que el adaptador de red esté en NAT y `ping 8.8.8.8` |
