# Resultados por RNF

Evidencias medidas del prototipo. Cada fila del PPT debería poder apoyarse en
una medición de este documento.

**Entorno de las mediciones de Windows:** Windows 10, 16 GB RAM, Python 3.11,
PostgreSQL 18, un solo proceso de `uvicorn`, pool de 20 conexiones, cliente y
servidor en la misma máquina. Los valores absolutos dependen de ese equipo; lo
que importa son las comparaciones entre filas.

**Estado:** las mediciones marcadas *(Windows)* ya están hechas. Las marcadas
*(pendiente, Ubuntu)* son las que faltan correr desde la máquina virtual
siguiendo [GUIA_UBUNTU.md](GUIA_UBUNTU.md); se espera que den valores parecidos
con algo más de latencia de red.

---

## RNF-01 · Eficiencia de desempeño

**Métrica del PPT:** ≥ 500 000 solicitudes/s

No se puede alcanzar esa cifra en un equipo de escritorio, y conviene decirlo
de frente. Lo que se hizo fue medir la capacidad real de una instancia y
justificar el escalado.

| Medición | Valor | Fuente |
|---|---|---|
| Reservas resueltas por una instancia | **≈ 240 por segundo** | `latencia.py --clientes 100` *(Windows)* |
| Admisión de la sala de espera | 50 usuarios/s (configurable) | `SALA_ADMITIDOS_POR_SEG` |
| Capacidad con N instancias | 240 × N tras un balanceador | justificación |

**Qué defender:** el límite no está en PostgreSQL. Duplicando el pool de
conexiones de 20 a 40, el p95 bajó solo de 387 ms a ~350 ms, así que el cuello
de botella es el proceso de aplicación. Eso es justamente lo que se resuelve
agregando instancias, no una máquina más grande. Para 500 000 solicitudes/s
harían falta del orden de 2 000 instancias detrás de un balanceador, más la
sala de espera conteniendo la avalancha en el borde.

---

## RNF-02 · Reserva ≤ 300 ms

**Métrica del PPT:** p95 ≤ 300 ms

### Butacas distintas *(Windows, 100 clientes)*

| Escenario | p95 | Resultado |
|---|---|---|
| Todos en el mismo instante | 387 ms | no cumple |
| A 50 clientes por segundo | **34 ms** | **cumple** |

El segundo es el escenario válido, porque la sala de espera no deja entrar más
de `SALA_ADMITIDOS_POR_SEG` por segundo. El primero muestra dónde se satura.

### Contención: todos contra la misma butaca *(Windows, 150 clientes, 4 corridas)*

| Modo | p95 | Reservas conseguidas |
|---|---|---|
| `sala` | 471 – 601 ms | 1 de 150 |
| `directo` | 492 – 543 ms | 1 de 150 |

### Pendiente

- `k6` con la condición `reserva_ms: p(95)<300` *(pendiente, Ubuntu)* — es la
  evidencia que el PPT menciona por nombre.
- Las mismas tres corridas desde Ubuntu *(pendiente)*.

---

## RNF-03 · Sobreventa = 0 %

**Métrica del PPT:** 0 % de sobreventa

300 clientes peleando todos por la **misma** butaca. Mismo script, mismo
número de clientes, lo único que cambia es el modo de reserva:

| Modo de reserva | Reservados | Rechazados | Tiempo total | Resultado |
|---|---|---|---|---|
| `inseguro` (leer y luego escribir) | **5** | 295 | 2 713 ms | **SOBREVENTA** |
| `sala` (UPDATE condicional) | **1** | 299 | 3 162 ms | **0 % de sobreventa** |
| `directo` (SELECT ... FOR UPDATE) | **1** | 299 | 1 968 ms | **0 % de sobreventa** |

*(Windows, `pruebas/sobreventa.py --clientes 300`. El tiempo total de `sala`
incluye pasar los 300 clientes por la cola, que los otros dos modos no tienen.)*

**Qué defender:** hay dos barreras, no una.

1. `UPDATE asientos SET ... WHERE id = %s AND estado = 'libre'` es atómico: la
   base de datos se lo entrega a un solo cliente.
2. El índice único `uq_orden_por_asiento` sobre `ordenes(asiento_id)` hace
   imposible dos órdenes para la misma butaca aunque la lógica de arriba
   fallara.

El modo `inseguro` existe precisamente para mostrar que el problema es real y
que no se arregla solo.

---

## RNF-04 · Seguridad del pago y del transporte

**Métrica del PPT:** TLS 1.3 + PCI-DSS

### Cifrado *(Windows)*

| Prueba | Resultado |
|---|---|
| Conexión TLS 1.3 | `New, TLSv1.3, Cipher is TLS_AES_256_GCM_SHA384` |
| Conexión TLS 1.2 | handshake fracasa: `New, (NONE), Cipher is (NONE)` |
| Recorrido completo de compra por HTTPS | sala → reserva → pago → QR → puerta, todo correcto |

El servidor acepta **solo TLS 1.3**: `scripts/servidor_tls.py` carga la
configuración de uvicorn, le fija el mínimo en TLS 1.3 y recién entonces
arranca, porque uvicorn por sí solo no permite fijar la versión mínima.

### Datos de tarjeta (alcance PCI-DSS)

El número de tarjeta **nunca llega al backend de la tiquetera**: el navegador
lo envía al proveedor simulado (`/simulador-pasarela/tokenizar`), que devuelve
un token, y a `/api/pagos` solo le llega ese token. En la base de datos quedan
únicamente los últimos 4 dígitos y el identificador del cargo. Eso es lo que
reduce el alcance de una auditoría PCI-DSS.

### Entradas no falsificables

El QR lleva el código de la orden y una firma HMAC-SHA256 con `SECRETO`:

| Caso probado | Respuesta |
|---|---|
| QR legítimo, primera vez | `valida` |
| El mismo QR otra vez | `repetida`, con la hora del primer uso |
| Firma alterada | `invalida` |
| Código inexistente con firma ajena | `invalida` |
| Consultar una entrada con otro correo | 404 |

La marca de usada se pone con `UPDATE ordenes SET usado_en = now() WHERE codigo
= %s AND usado_en IS NULL`: la misma técnica del RNF-03, así que una entrada no
puede pasar dos veces ni escaneándola a la vez en dos puertas.

### Pendiente

- `testssl.sh` contra `10.0.2.2:8443` *(pendiente, Ubuntu)* — la evidencia
  formal de que TLS 1.0/1.1/1.2 no se ofrecen.
- OWASP ZAP contra `10.0.2.2:8000` *(pendiente, Ubuntu)*.

---

## RNF-05 · Bloqueo de bots ≥ 99.8 %

**Métrica del PPT:** ≥ 99.8 % de bots bloqueados

### Ráfaga de 30 000 peticiones desde una IP *(Windows)*

| Medida | Valor |
|---|---|
| Ritmo del atacante | 917 peticiones/s |
| Pasaron | **240** (= 60 por ventana × 4 ventanas) |
| Bloqueadas | 29 760 (**99.20 %**) |
| Tope teórico | 240 |

Pasaron exactamente las 240 previstas: el limitador se comporta igual que su
diseño.

**Cómo defender el 99.8 %:** lo que el sistema garantiza no es un porcentaje,
es un **tope absoluto** de 6 peticiones por segundo y por IP (60 cada 10 s). El
porcentaje bloqueado se deduce de ahí y depende de cuán rápido ataque el bot:

| Ritmo del bot | Porcentaje bloqueado |
|---|---|
| 60 pet./s | 90.00 % |
| 600 pet./s | 99.00 % |
| **3 000 pet./s** | **99.80 %** |
| 10 000 pet./s | 99.94 % |

Desde una sola máquina se llegó a 917 pet./s. Para superar el 99.8 % el
atacante debe sostener más de 3 000 pet./s, algo que logra una botnet pero no
un equipo suelto; y en producción el WAF corta antes de llegar a la aplicación.

### Otras defensas *(Windows)*

| Comprobación | Resultado |
|---|---|
| Un cliente intenta reservar 10 butacas | consigue 4, las otras 6 dan 429 |
| Reservar sin pasar por la sala de espera | 403 |
| Pase de la sala inventado | 403 |
| Pase con la firma alterada | 403 |

---

## El trade-off: qué dicen las mediciones

El PPT plantea alta concurrencia contra consistencia. Las mediciones matizan
esa idea en tres puntos, y el tercero corrige lo que se suponía:

1. **La consistencia no cuesta rendimiento.** `sala` y `directo` garantizan los
   dos cero sobreventa y miden prácticamente igual. El que "gana" tiempo es
   `inseguro`, y lo paga vendiendo la misma butaca cinco veces.

2. **Lo que protege la latencia es la sala de espera, no el SQL.** El mismo
   sistema pasa de 387 ms a 34 ms —once veces mejor— solo controlando el ritmo
   de llegada. No se cambió una línea de SQL entre las dos corridas.

3. **El `UPDATE` atómico no es más rápido que `SELECT ... FOR UPDATE`.**
   PostgreSQL serializa las escrituras sobre una misma fila en los dos casos,
   porque un `UPDATE` también toma el bloqueo de la fila. Su ventaja real es
   otra: resuelve la operación en una sentencia en vez de dos, así que mantiene
   el bloqueo menos tiempo y no depende de que la aplicación recuerde abrir una
   transacción.

---

## Lo que falta para la entrega

| Tarea | Estado |
|---|---|
| Correr las pruebas desde Ubuntu | pendiente — [GUIA_UBUNTU.md](GUIA_UBUNTU.md) |
| k6 con el umbral del RNF-02 | pendiente (Ubuntu) |
| testssl.sh y OWASP ZAP | pendiente (Ubuntu) |
| Capturas de pantalla de las evidencias | pendiente |
| Pasar estas tablas al PPT | pendiente |
| Ensayo de la exposición | pendiente — [GUIA_DEMOSTRACION.md](GUIA_DEMOSTRACION.md) |
