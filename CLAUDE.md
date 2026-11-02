# Contexto del proyecto

Proyecto del curso **Calidad Aplicada a los Sistemas de Información** (UNAMAD).
Entrega y exposición: **3 de noviembre de 2026**.

Consigna del docente: tomar el caso que el grupo expuso (Caso 2: Pasarela de pagos
para eventos masivos), realizar o justificar lo que se puso en el PPT (RNF según
ISO/IEC 25010, trade-off y arquitectura), desarrollar el sistema y demostrarlo con
pruebas hechas con software libre en Ubuntu.

## RNF del PPT y cómo se cubren

| RNF | ISO 25010 | Métrica del PPT | En el prototipo |
|---|---|---|---|
| RNF-01 | Eficiencia de desempeño | ≥ 500 000 solicitudes/s | Sala de espera virtual; prueba a escala reducida + justificación de escalado horizontal |
| RNF-02 | Eficiencia de desempeño | Reserva ≤ 300 ms | UPDATE atómico, pool de conexiones; se mide p95 con k6 |
| RNF-03 | Adecuación funcional | Sobreventa = 0 % | UPDATE condicional + índice único en `ordenes`; `pruebas/sobreventa.py` |
| RNF-04 | Seguridad | TLS 1.3 + PCI-DSS | Tokenización simulada (el backend nunca recibe la tarjeta); HTTPS solo TLS 1.3 en `scripts/servidor_tls.py` (puerto 8443) |
| RNF-05 | Seguridad | Bloqueo bots ≥ 99.8 % | Limitador por IP, máx. 4 entradas por cliente, pase HMAC |

Trade-off: alta concurrencia vs. consistencia (cero sobreventa). Se demuestra
comparando `MODO_RESERVA=directo` (sin sala, FOR UPDATE) contra `sala` con la misma
prueba de carga. `inseguro` existe solo para mostrar la sobreventa.

Redis, Kafka, WAF y reCAPTCHA del PPT se **justifican** y no se implementan (ver README).

## Entorno del alumno

- Windows 10, 16 GB RAM, Python 3.11, PostgreSQL 18, VS Code, PowerShell.
- Internet lento/inestable: `pip install` desde PyPI suele cortarse. Las dependencias
  se instalaron sin internet desde la carpeta `paquetes/` con
  `.venv\Scripts\python -m pip install --no-index --find-links paquetes -r requirements.txt`.
- Usar siempre `.venv\Scripts\python ...` (no activar el venv; no cambiar la
  política de ejecución de PowerShell).
- El servidor escucha en 127.0.0.1:8000. Las pruebas se harán desde Ubuntu en
  VirtualBox (red NAT), que ve el Windows anfitrión como `10.0.2.2`. No tocar el firewall.
- Para pruebas de carga/concurrencia: `ANTIBOTS=0` en `.env` (todo sale de una IP).

## Forma de trabajar

- El alumno es principiante y debe poder **explicar y defender cada parte** en la
  exposición: cambios pequeños, explicados en español sencillo, paso a paso.
- El código debe verse escrito por una persona: nombres en español, comentarios
  solo donde aportan, sin emojis ni comentarios obvios.
- No agregar dependencias nuevas sin avisar (hay que descargarlas a `paquetes/`).
- Antes de dar algo por terminado, levantar el servidor y probarlo.
- El objetivo es aprobar el curso de Calidad: priorizar RNF, pruebas y evidencias
  sobre agregar pantallas.

## Plan

1. Hasta el 23/10: catálogo de eventos + detalle, entrada con QR y "Mis compras",
   panel de administrador con ventas y métricas en vivo (`/api/salud`).
2. 24/10: VirtualBox + Ubuntu 24.04 y conexión con el sistema.
3. 25–29/10: pruebas por RNF (k6, script de sobreventa, OWASP ZAP, testssl.sh,
   script de bots) y comparación del trade-off.
4. 30/10–02/11: resultados, gráficos, presentación y ensayo.
