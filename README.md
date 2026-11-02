# Tiquetera: pasarela de pagos para eventos masivos (Caso 2)

Prototipo de un sistema de venta de entradas que cumple los RNF del Caso 2:
alta concurrencia, cero sobreventa, pagos seguros y bloqueo de bots.

| Componente | Tecnología |
|---|---|
| Backend / API | Python + FastAPI |
| Base de datos | PostgreSQL |
| Frontend | HTML + CSS + JavaScript (sin frameworks) |
| Pago | Proveedor simulado con tokenización (no se guardan tarjetas) |
| Código QR | `segno` (Python puro, sin dependencias) |

> Documentos de apoyo:
> - [GUIA_DEMOSTRACION.md](GUIA_DEMOSTRACION.md): la secuencia exacta de comandos para la exposición.
> - [GUIA_UBUNTU.md](GUIA_UBUNTU.md): cómo correr las pruebas desde la máquina virtual.
> - [RESULTADOS.md](RESULTADOS.md): las evidencias medidas, RNF por RNF.

## Cómo levantarlo en Windows

Requisitos: Python 3.11 o superior, PostgreSQL con una base llamada `pasarela`.

Abre la carpeta del proyecto en VS Code y, en la terminal (Ctrl + ñ):

```powershell
# 1. Crear el entorno virtual e instalar dependencias (solo la primera vez)
python -m venv .venv
.venv\Scripts\python -m pip install --no-index --find-links paquetes -r requirements.txt
#    (las dependencias ya están descargadas en la carpeta paquetes\, no hace
#     falta internet; sin --no-index se instalarían desde PyPI)

# 2. Configuración: copia el ejemplo y pon tu contraseña de PostgreSQL
copy .env.example .env
#    -> abre .env y cambia TU_CLAVE por tu contraseña

# 3. Crear tablas y cargar el evento con 200 asientos
.venv\Scripts\python scripts\iniciar_bd.py

# 4. Levantar el servidor
.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Abre en el navegador:

- http://127.0.0.1:8000 : la página de venta
- http://127.0.0.1:8000/docs : documentación interactiva de la API

Para detener el servidor usa `Ctrl + C`.

> Se usa `.venv\Scripts\python` directamente para no tener que cambiar
> la política de ejecución de PowerShell.

## Pantallas

El recorrido del comprador es el mismo de una tiquetera real:

1. **Cartelera** (`#/`): evento destacado y la rejilla con los cinco eventos.
2. **Detalle del evento** (`#/evento/2`): afiche, descripción, ficha de datos y
   las zonas con su precio y disponibilidad.
3. **Sala de espera**: solo al entrar a comprar. La cartelera y el detalle se
   pueden ver sin pase, porque son de lectura; la sala protege la compra.
4. **Mapa de asientos y pago**: con el reloj de la reserva.
5. **Mis entradas** (`#/mis-entradas`): las entradas compradas desde ese
   navegador, cada una con su código QR. También se puede recuperar una entrada
   escribiendo el código y el correo de la compra.
6. **Panel de administración** (`admin.html`): ventas, ocupación por evento,
   métricas en vivo, control de acceso en la puerta y últimas compras.

Los afiches están en `static/img` como SVG hechos a mano, para no depender de
descargas. La columna `imagen` de la tabla `eventos` guarda el nombre del
archivo, así que se pueden reemplazar por fotos reales (`.jpg`) cambiando ese
valor en `scripts/iniciar_bd.py`.

## Entradas con QR y control de acceso

Cada compra genera una entrada con un QR. El QR **no lleva datos personales**:
solo el código de la orden y una firma HMAC-SHA256 hecha con `SECRETO`.

```
TIQUETERA|ORD-1A2B3C4D|885cf1028007180c
          codigo       firma (16 caracteres)
```

- Sin conocer `SECRETO` nadie puede fabricar un QR que valide: es el mismo
  mecanismo que firma los pases de la sala de espera (RNF-05).
- Para ver una entrada hay que dar el código **y** el correo de la compra, así
  que con el código suelto no se puede leer el nombre ni el correo del comprador.
- En la puerta, el panel marca la entrada como usada con un `UPDATE` condicional
  (`WHERE usado_en IS NULL`). Es la misma técnica que evita la sobreventa: si el
  mismo QR se escanea dos veces, la segunda responde `repetida`. Sirve para
  explicar la idea del RNF-03 aplicada a otro caso.

`SECRETO` debe estar fijo en el `.env`. Si cambia, los QR ya emitidos dejan de
validar, porque la firma se calcula con esa clave.

## Panel de administración

En `http://127.0.0.1:8000/admin.html`, con la clave de `ADMIN_CLAVE` (`.env`).
Las rutas `/api/admin/...` piden la cabecera `X-Clave-Admin`; sin ella responden
401, y cada intento fallido queda contado en las métricas.

| Sección | Para qué sirve en la exposición |
|---|---|
| Indicadores | Entradas vendidas, ingresos, ocupación y entradas usadas |
| Ocupación por evento | Barra por evento con vendidos, reservados y aforo |
| Control de acceso | Se pega el contenido de un QR y responde válida / repetida / inválida |
| Métricas en vivo | Contadores de `/api/salud` cada 3 s: reservas, rechazos, bloqueos de bots |
| Últimas compras | Las 15 últimas órdenes con su estado en la puerta |

El botón **Reiniciar contadores** deja las métricas en cero: conviene usarlo
justo antes de cada prueba de carga para que las cifras sean solo de esa prueba.

## HTTPS con TLS 1.3 (RNF-04)

El sistema se puede servir cifrado. Son dos pasos, y el certificado se crea
una sola vez:

```powershell
# 1. Crear el certificado autofirmado (usa el openssl que viene con Git)
.venv\Scripts\python scripts\crear_certificado.py

# 2. Levantar el servidor con HTTPS en el puerto 8443
.venv\Scripts\python scripts\servidor_tls.py
```

Queda en `https://127.0.0.1:8443` y, desde la máquina virtual,
`https://10.0.2.2:8443`. El certificado incluye esa IP entre sus nombres
válidos, así que sirve para las dos.

**El servidor acepta únicamente TLS 1.3.** `uvicorn` permite poner el
certificado pero no la versión mínima de TLS, así que `scripts/servidor_tls.py`
carga la configuración, le fija el mínimo en TLS 1.3 y recién entonces arranca.
Con `--minimo 1.2` se puede aflojar para comparar.

El puerto 8000 sigue sirviendo HTTP sin cifrar: ahí se hacen las pruebas de
carga, porque el cifrado solo agregaría ruido a la medición de los tiempos.

### Evidencia

```bash
# Versión y cifrado negociados (desde Windows, con el openssl de Git)
openssl s_client -connect 127.0.0.1:8443 -tls1_3
#   -> New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384

# TLS 1.2 debe fracasar: "New, (NONE), Cipher is (NONE)"
openssl s_client -connect 127.0.0.1:8443 -tls1_2

# Desde Ubuntu en VirtualBox
curl -k https://10.0.2.2:8443/api/config
./testssl.sh --severity LOW 10.0.2.2:8443
```

Dos cosas que conviene decir antes de que las pregunten:

- El certificado es **autofirmado**, así que el navegador avisa y hay que
  aceptar. Un certificado firmado por una autoridad reconocida necesita un
  dominio público, que un prototipo de curso no tiene. Lo que se demuestra es
  la configuración del cifrado, no la cadena de confianza.
- No se envía la cabecera **HSTS** a propósito: obliga al navegador a usar
  HTTPS para ese host durante meses, y eso dejaría inservible el servidor HTTP
  del puerto 8000 que se usa en las pruebas de carga. En producción, con un
  dominio real, sí se activa.

## Imágenes

Los afiches de `static/img` son fotografías con licencia libre. Se dejan
también los cinco afiches dibujados en SVG, por si se quiere volver a ellos.

| Archivo | Origen y licencia |
|---|---|
| `grupo5.jpg`, `agua-marina.jpg`, `sinfonica-foto.jpg`, `lima-beat-foto.jpg` | Pexels, licencia libre, sin atribución obligatoria |
| `libido.jpg` | *Libido band in live in concert in UNMSM*, por RockSkaPunkMetal, Wikimedia Commons, **CC BY-SA 4.0** |

La foto de Líbido exige atribución por su licencia, y por eso figura aquí con
su autor. Las de Pexels no la exigen.

Para cambiar el afiche de un evento se guarda la imagen en `static/img` y:

```powershell
.venv\Scripts\python scripts\cambiar_afiche.py --listar
.venv\Scripts\python scripts\cambiar_afiche.py --evento 1 --imagen grupo5.jpg
```

Los nombres de los artistas son reales para que la cartelera se vea creíble,
pero el sistema es un prototipo académico: no vende entradas ni cobra pagos, y
así lo dice el aviso que aparece en la parte superior de la página.

## Modos de reserva (para demostrar el trade-off)

Se cambia `MODO_RESERVA` en el archivo `.env` y se reinicia el servidor.

| Modo | Qué hace | Para qué sirve |
|---|---|---|
| `sala` | Sala de espera + reserva atómica (un solo `UPDATE` condicional) | Versión final |
| `directo` | Sin sala de espera, bloqueo pesimista `SELECT ... FOR UPDATE` | Comparar rendimiento contra `sala` |
| `inseguro` | Lee y luego escribe sin control | Demostrar que sin control hay sobreventa |

## Cómo se cubre cada RNF

| RNF | Cómo se implementa | Archivo |
|---|---|---|
| RNF-01 Soportar la demanda | Sala de espera virtual que admite N usuarios/seg | `app/sala_espera.py` |
| RNF-02 Reserva ≤ 300 ms | `UPDATE` atómico, pool de conexiones, el pago fuera de la transacción | `app/reservas.py` |
| RNF-03 Sobreventa 0 % | `UPDATE ... WHERE estado='libre'` + índice único en `ordenes` | `app/reservas.py`, `sql/esquema.sql` |
| RNF-04 TLS 1.3 + PCI-DSS | Tokenización (el backend nunca recibe la tarjeta), HTTPS solo TLS 1.3 y QR firmado con HMAC | `app/pasarela_simulada.py`, `scripts/servidor_tls.py`, `app/entradas.py` |
| RNF-05 Bloqueo de bots ≥ 99.8 % | Límite de peticiones por IP + máximo 4 entradas por cliente + pase firmado (HMAC) | `app/antibots.py`, `app/main.py` |

## Pruebas

Las cuatro pruebas corren con software libre y sin instalar nada en Ubuntu,
salvo k6: `latencia.py`, `sobreventa.py` y `bots.py` usan solo la librería
estándar de Python 3 (`sobreventa.py` necesita `httpx`: `sudo apt install python3-httpx`).

Cada prueba necesita un ajuste distinto en el `.env`, y hay que **reiniciar el
servidor** después de cambiarlo:

| Prueba | ANTIBOTS | MODO_RESERVA |
|---|---|---|
| RNF-02 latencia | `0` | `sala` y después `directo` |
| RNF-03 sobreventa | `0` | `sala`, `directo` e `inseguro` |
| RNF-05 bots | `1` | `sala` |
| RNF-04 TLS | indiferente | indiferente |

`ANTIBOTS=0` es necesario en las pruebas de carga porque todas las peticiones
salen de la misma IP y el limitador las cortaría; en la prueba de bots es justo
lo contrario, porque el limitador es lo que se está midiendo.

Antes de cada corrida conviene liberar el aforo:

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 20 --por-fila 25
```

### RNF-02: tiempo de reserva <= 300 ms

```powershell
.venv\Scripts\python pruebas\latencia.py --clientes 100              # todos a la vez
.venv\Scripts\python pruebas\latencia.py --clientes 100 --ritmo 50   # 50 por segundo
.venv\Scripts\python pruebas\latencia.py --clientes 150 --mismo-asiento
```

Desde Ubuntu se agrega `--url http://10.0.2.2:8000`. Con `--guardar
resultados/sala-ritmo.json` queda el resumen en un archivo.

Los tres escenarios miden cosas distintas y conviene mostrar los tres:

| Escenario | Qué representa |
|---|---|
| Todos a la vez | Peor caso absoluto: 100 reservas en el mismo instante |
| `--ritmo 50` | El caso real: la sala no admite más de `SALA_ADMITIDOS_POR_SEG` |
| `--mismo-asiento` | Contención: todos pelean por la misma butaca |

### RNF-02 con k6 (desde Ubuntu)

```bash
k6 run -e BASE=http://10.0.2.2:8000 pruebas/carga.js
k6 run -e BASE=http://10.0.2.2:8000 -e VUS=200 pruebas/carga.js
```

Cada usuario virtual hace el recorrido completo (sala, reserva, liberar) y la
condición `reserva_ms: p(95)<300` hace que k6 falle solo si el RNF-02 no se
cumple. Las instrucciones para instalar k6 en Ubuntu 24.04 están al comienzo de
`pruebas/carga.js`.

### RNF-03: sobreventa = 0 %

```powershell
.venv\Scripts\python pruebas\sobreventa.py --clientes 300
```

Resultado esperado en modo `sala` o `directo`: **1 reservado, 299 rechazados**.
En modo `inseguro` varios clientes "ganan" la misma butaca, que es justamente
lo que se quiere mostrar.

### RNF-05: bloqueo de bots

```powershell
.venv\Scripts\python pruebasots.py --peticiones 4000
```

Son cuatro comprobaciones: ráfaga desde una IP, un cliente intentando pasar del
tope de 4 entradas, una reserva sin pase y dos pases falsificados.

### Resultados medidos

Medidos en el equipo del alumno (Windows 10, 16 GB, PostgreSQL 18, un solo
proceso de uvicorn, pool de 20 conexiones), 100 o 150 clientes según la prueba.
Los valores absolutos dependen de ese equipo; lo que importa son las
comparaciones entre filas.

**RNF-02, butacas distintas (p95 de la reserva):**

| Modo | Todos a la vez | A 50 clientes/s |
|---|---|---|
| `sala` | 387 ms (no cumple) | **34 ms (cumple)** |
| `directo` | 382 ms (no cumple) | 38 ms (cumple) |

**RNF-02, todos contra la misma butaca, 150 clientes (4 corridas cada uno):**

| Modo | p95 | Reservas conseguidas |
|---|---|---|
| `sala` | 471 – 601 ms | 1 de 150 |
| `directo` | 492 – 543 ms | 1 de 150 |

**RNF-05, ráfaga de 30 000 peticiones desde una IP:**

| Medida | Valor |
|---|---|
| Ritmo del bot | 917 peticiones/s |
| Pasaron | 240 (= 60 por ventana x 4 ventanas) |
| Bloqueadas | 29 760 (**99.20 %**) |

El tope teórico eran 240 y pasaron exactamente 240: el limitador se comporta
igual que su diseño.

### Qué dicen las mediciones sobre el trade-off

Tres conclusiones, y la primera corrige lo que se suponía en la propuesta:

1. **Entre `sala` y `directo` no hay diferencia medible de latencia.** Ni con
   butacas distintas ni peleando por la misma. Tiene explicación: PostgreSQL
   tiene que serializar las escrituras sobre una misma fila en los dos casos,
   porque un `UPDATE` también toma el bloqueo de la fila. El `UPDATE` atómico no
   es más rápido que `SELECT ... FOR UPDATE`; lo que hace es resolverlo en una
   sola sentencia en vez de dos, así que mantiene el bloqueo menos tiempo y no
   depende de que la aplicación se acuerde de abrir una transacción.

2. **Lo que de verdad protege la latencia es la sala de espera.** El mismo
   sistema pasa de 387 ms a 34 ms (11 veces mejor) con solo controlar el ritmo
   de llegada. No se cambió una línea de SQL: se cambió cuánta gente llega a la
   vez. Ahí está el valor de la sala, y por eso el RNF-01 y el RNF-02 se
   sostienen juntos.

3. **A ráfaga pura el cuello de botella es el proceso, no la base de datos.**
   Un solo proceso de uvicorn resuelve unas 240 reservas por segundo; 100
   reservas simultáneas hacen cola y las últimas esperan ~400 ms. Duplicar el
   pool de conexiones (20 a 40) solo bajó el p95 de 387 a ~350 ms, así que el
   límite no está en PostgreSQL. La salida es horizontal: más instancias detrás
   de un balanceador, que es exactamente lo que el RNF-01 justifica.

Y el modo `inseguro` cierra el argumento: es el único que "gana" tiempo
saltándose el control, y lo paga vendiendo la misma butaca dos veces.

### Utilidades

```powershell
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar                        # dejar todos los asientos libres
.venv\Scripts\python scripts\iniciar_bd.py --reiniciar --filas 26 --por-fila 40  # 1040 asientos
```

`GET /api/salud` muestra los contadores en bruto (reservas, rechazos, bloqueos
de bots, validaciones de entradas). El panel de administración los presenta ya
con nombres y permite ponerlos en cero antes de cada prueba.

## Lo que se justifica y no se implementa

| En la propuesta (PPT) | En el prototipo | Justificación |
|---|---|---|
| Redis para reservas en memoria | PostgreSQL con `UPDATE` atómico | Misma garantía de cero sobreventa; Redis aporta velocidad a escala real |
| Kafka para compras confirmadas | Escritura directa en PostgreSQL | A la escala del prototipo no hace falta una cola de eventos |
| WAF + reCAPTCHA | Limitador por IP en la propia app | Mismo principio; en producción lo hace un WAF delante |
| 500 000 solicitudes/s | Prueba a escala reducida | Se escala horizontalmente con más instancias detrás de un balanceador |
| PCI-DSS | Tokenización simulada | La certificación es de la empresa; el diseño reduce el alcance al no tocar tarjetas |
