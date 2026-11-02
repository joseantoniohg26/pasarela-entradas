# Guía de demostración

Qué escribir y en qué orden para mostrar el sistema completo. Todos los
comandos están probados en este equipo y se ejecutan desde la carpeta del
proyecto (`C:\Users\Usuario\Documents\pasarela-entradas`) en PowerShell.

## Regla que evita el 90 % de los problemas en vivo

**No edites el `.env` durante la exposición.** Cada prueba necesita una
configuración distinta, y si editas el archivo a mano es fácil dejarlo mal.
En su lugar, se pone la configuración **delante del comando**, y así vale solo
para esa terminal:

```powershell
$env:ANTIBOTS = "0"; $env:MODO_RESERVA = "inseguro"; .venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Las variables de entorno tienen prioridad sobre el `.env`, y al cerrar la
terminal se olvidan. El `.env` queda siempre en su estado normal
(`MODO_RESERVA=sala`, `ANTIBOTS=1`).

## Diez minutos antes

1. Que PostgreSQL esté corriendo:

   ```powershell
   Get-Service -Name postgresql*
   ```

   Si dice `Stopped`: `Start-Service -Name postgresql-x64-18`

2. Abrir **tres terminales** en VS Code (Ctrl + Shift + ñ para dividir):
   - **T1** el servidor HTTP
   - **T2** el servidor HTTPS
   - **T3** las pruebas

3. Dejar el aforo limpio y crear los datos:

   ```powershell
   .venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
   ```

4. Levantar el servidor en **T1**:

   ```powershell
   .venv\Scripts\python -m uvicorn app.main:app --port 8000
   ```

5. Abrir en el navegador y dejar las pestañas listas:
   - `http://127.0.0.1:8000` (la tienda)
   - `http://127.0.0.1:8000/admin.html` (el panel; la clave es el valor de `ADMIN_CLAVE` en tu archivo `.env`)

---

## Bloque 1 · El sistema funcionando (4 minutos)

Sin tocar ninguna configuración. Es la parte que se ve, y conviene empezar por
aquí para que el resto tenga contexto.

1. **Cartelera**: los cinco eventos. Señalar que esta pantalla no pide pase,
   porque es de solo lectura.
2. Entrar a un evento: zonas, precios, disponibilidad por zona.
3. **Comprar entradas** → aparece la **sala de espera** (dura un segundo porque
   no hay nadie más en la cola; con 300 personas es lo que se mide en el
   bloque 3).
4. Elegir una butaca → arranca el reloj de 5 minutos.
5. Pagar con la tarjeta de prueba **4111 1111 1111 1111**, vence `12/28`,
   CVV `123`.

   Aquí decir la frase importante: *el número de la tarjeta no pasa por nuestro
   backend*. Va al simulador del proveedor, que devuelve un token, y al backend
   solo le llega ese token. Eso es lo que reduce el alcance de PCI-DSS.

6. **Ver mi entrada con QR** → se ve la entrada con su código QR.
7. Si se quiere mostrar la tarjeta rechazada, repetir con
   **4000 0000 0000 0002**.

### Control de acceso en la puerta

1. En la entrada, abrir **"Ver lo que dice el QR"** y pulsar **Copiar**.
   (Se muestra el texto porque en la exposición no hay un escáner real; lo que
   se copia es exactamente lo que leería el escáner.)
2. Ir al **panel** → *Control de acceso* → pegar → **Validar entrada**.
   - Primera vez: **ENTRADA VÁLIDA**.
   - Pegar de nuevo y validar: **ENTRADA REPETIDA**, con la hora del primer uso.
   - Cambiar un carácter de la firma: **QR INVÁLIDO**.

Frase para este momento: *la entrada se marca como usada con un `UPDATE`
condicional, la misma técnica que evita la sobreventa. Una entrada no puede
pasar dos veces por la misma razón por la que una butaca no se vende dos veces.*

### El panel

Mostrar los indicadores, la ocupación por evento y las **métricas en vivo**
(se refrescan cada 3 segundos). Dejar esta pestaña abierta: durante las pruebas
del bloque 3 los contadores se mueven solos y se ve en directo.

---

## Bloque 2 · HTTPS con TLS 1.3 — RNF-04 (2 minutos)

En **T2**:

```powershell
.venv\Scripts\python scripts\servidor_tls.py
```

(Si dice que faltan los certificados:
`.venv\Scripts\python scripts\crear_certificado.py`)

Abrir `https://127.0.0.1:8443` y aceptar el aviso del navegador: el certificado
es autofirmado, y eso **se explica, no se esconde**: un certificado firmado por
una autoridad reconocida necesita un dominio público, que un prototipo de curso
no tiene. Lo que se demuestra es la configuración del cifrado.

En **T3**, la evidencia:

```powershell
$openssl = "C:\Program Files\Git\mingw64\bin\openssl.exe"

# TLS 1.3: funciona
"" | & $openssl s_client -connect 127.0.0.1:8443 -tls1_3 2>$null | Select-String "Cipher is"
#   -> New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384

# TLS 1.2: el servidor lo rechaza
"" | & $openssl s_client -connect 127.0.0.1:8443 -tls1_2 2>$null | Select-String "Cipher is"
#   -> New, (NONE), Cipher is (NONE)
```

El servidor acepta **solo TLS 1.3**. `uvicorn` deja poner el certificado pero no
la versión mínima, así que el script carga la configuración, le fija el mínimo
y recién entonces arranca.

---

## Bloque 3 · Sobreventa — RNF-03 (5 minutos)

El momento más fuerte de la exposición: el mismo sistema, el mismo script, dos
formas de reservar y dos resultados opuestos.

### Primero el sistema MAL hecho

Detener **T1** con `Ctrl + C` y levantarlo sin control de concurrencia:

```powershell
$env:ANTIBOTS = "0"; $env:MODO_RESERVA = "inseguro"; .venv\Scripts\python -m uvicorn app.main:app --port 8000
```

En **T3**:

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
.venv\Scripts\python pruebas\sobreventa.py --clientes 300
```

Resultado medido en este equipo: **5 clientes "ganaron" la misma butaca**.
Cinco personas compraron el mismo asiento. (El número varía entre corridas:
lo que importa es que sea mayor que 1.)

### Ahora el sistema BIEN hecho

Detener **T1** y levantarlo en el modo final:

```powershell
$env:ANTIBOTS = "0"; $env:MODO_RESERVA = "sala"; .venv\Scripts\python -m uvicorn app.main:app --port 8000
```

En **T3**, exactamente el mismo comando:

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
.venv\Scripts\python pruebas\sobreventa.py --clientes 300
```

Resultado: **1 reservado, 299 rechazados. Sobreventa = 0 %.**

Qué explicar: el `UPDATE ... WHERE estado = 'libre'` es atómico, así que la base
de datos le entrega la fila a uno solo. Y hay una segunda barrera: el índice
único `uq_orden_por_asiento`, que hace imposible dos órdenes para la misma
butaca aunque la lógica de arriba falle.

---

## Bloque 4 · Tiempo de reserva y el trade-off — RNF-02 (4 minutos)

Con **T1** todavía en `sala` + `ANTIBOTS=0`, en **T3**:

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
.venv\Scripts\python pruebas\latencia.py --clientes 100

.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
.venv\Scripts\python pruebas\latencia.py --clientes 100 --ritmo 50
```

| Escenario | p95 medido | RNF-02 (<= 300 ms) |
|---|---|---|
| 100 reservas en el mismo instante | 387 ms | no cumple |
| 100 reservas a 50 por segundo | **34 ms** | cumple |

Este es el argumento central y conviene decirlo con calma: **no se cambió una
línea de SQL entre las dos corridas**. Lo único distinto es cuánta gente llega a
la vez. Once veces mejor solo por controlar el ritmo de llegada — y controlar el
ritmo de llegada es exactamente lo que hace la sala de espera.

Si hay tiempo y preguntan por el bloqueo pesimista, se repite con
`MODO_RESERVA=directo`: da prácticamente lo mismo (382 ms y 38 ms), porque
PostgreSQL serializa las escrituras sobre una misma fila en los dos casos. La
ventaja del `UPDATE` atómico no es velocidad: es resolverlo en una sentencia en
vez de dos, manteniendo el bloqueo menos tiempo.

---

## Bloque 5 · Bloqueo de bots — RNF-05 (3 minutos)

Esta prueba necesita el limitador **encendido**, al revés que las anteriores.
Detener **T1** y levantarlo sin variables, como está en el `.env`:

```powershell
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

En **T3**:

```powershell
.venv\Scripts\python pruebas\bots.py --peticiones 4000
```

Las cuatro comprobaciones salen `CUMPLE`:

| Comprobación | Resultado |
|---|---|
| Un cliente intenta acaparar 10 butacas | consigue 4, las otras 6 dan 429 |
| Reservar sin pasar por la sala | 403 |
| Dos pases falsificados | 403 los dos |
| Ráfaga desde una IP | pasan exactamente 60 por ventana |

Con 30 000 peticiones se midió **99.20 % bloqueado** y pasaron exactamente 240,
que es el tope teórico (60 × 4 ventanas): el limitador se comporta igual que su
diseño. Para pasar del 99.8 % que pide el RNF-05 el bot tiene que sostener más
de 3 000 peticiones por segundo; eso lo logra una botnet, no un equipo suelto, y
en producción el WAF corta antes de llegar a la aplicación.

Mientras corre esta prueba, mirar el **panel**: el contador de "Peticiones
bloqueadas por el limitador" sube en vivo.

---

## Dejar todo como estaba

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
```

Cerrar las terminales donde se usaron variables de entorno. El `.env` no se
tocó en ningún momento.

---

## Si algo falla

| Problema | Qué hacer |
|---|---|
| `No se pudo conectar a PostgreSQL` | `Start-Service -Name postgresql-x64-18` |
| `address already in use` | Ya hay un servidor en ese puerto: `Get-Process python \| Stop-Process` y volver a levantarlo |
| Las pruebas dan muchos `429` | Falta `$env:ANTIBOTS = "0"` en la terminal del servidor |
| `bots.py` dice "Antibots: DESACTIVADO" | Al contrario: levantar el servidor **sin** variables de entorno |
| `No quedan asientos libres` | `iniciar_bd.py --reiniciar --filas 20 --por-fila 25` |
| La sala de espera no avanza | El servidor se reinició y el pase viejo no vale: recargar la página |
| El navegador no guarda la compra | Se guarda en `localStorage`; en ventana de incógnito se pierde al cerrar |
| El QR no valida | El servidor se levantó sin `SECRETO`; debe estar fijo en el `.env` |

## Orden sugerido si hay poco tiempo

Con 10 minutos: bloque 1 (compra + QR + puerta) y bloque 3 (sobreventa).
Son los dos que muestran algo que se ve y algo que se mide.
