# Etapa 1: Compilación en Go con binario estático optimizado
FROM golang:1.24-alpine AS builder

WORKDIR /app

# Instalar dependencias de compilación
RUN apk add --no-cache git ca-certificates tzdata

COPY go.mod go.sum ./
RUN go mod download

COPY . .

# CGO_ENABLED=0 para generar un binario completamente estático sin dependencias de libc
# -ldflags="-s -w" para eliminar tablas de símbolos y reducir el tamaño del binario al mínimo
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /app/server ./cmd/server

# Etapa 2: Imagen final ultra-liviana (Scratch / Distroless)
FROM alpine:3.20

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata

# Copiar zonas horarias y certificados SSL
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/

# Copiar binario compilado y archivos estáticos de la UI
COPY --from=builder /app/server /app/server
COPY --from=builder /app/static /app/static

# Usuario sin privilegios por seguridad
RUN adduser -D -u 1000 appuser
USER appuser

EXPOSE 8000

ENTRYPOINT ["/app/server"]

