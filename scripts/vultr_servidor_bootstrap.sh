#!/bin/bash
set -e

# ==============================================================================
# Vultr Startup Script: Servidor Tiquetera (Ubuntu 24.04 LTS)
# Instala Docker, configura firewall UFW, clona el repositorio y levanta la app.
# ==============================================================================

export DEBIAN_FRONTEND=noninteractive

echo ">>> 1. Actualizando sistema y paquetes base..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban ca-certificates gnupg jq

echo ">>> 2. Configurando Firewall UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
ufw allow 8000/tcp  # Tiquetera Go / Web
ufw --force enable

echo ">>> 3. Instalando Docker oficial para Ubuntu 24.04 (Noble)..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    | tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

systemctl enable --now docker

echo ">>> 4. Clonando repositorio del proyecto..."
cd /root
if [ -d "/root/pasarela-entradas" ]; then
    cd /root/pasarela-entradas
    git fetch origin
    git reset --hard origin/main
else
    git clone https://github.com/joseantoniohg26/pasarela-entradas.git
    cd /root/pasarela-entradas
fi

echo ">>> 5. Configurando variables de entorno de produccion (.env)..."
cat << 'EOF' > .env
DATABASE_URL=postgresql://postgres:postgres@db:5432/pasarela?sslmode=disable
MODO_RESERVA=sala
RESERVA_MINUTOS=5
PASE_MINUTOS=15
MAX_ENTRADAS_POR_CLIENTE=6
SALA_ADMITIDOS_POR_SEG=50
ANTIBOTS=1
LIMITE_PETICIONES=120
VENTANA_SEGUNDOS=10
POOL_MAX=50
POOL_TIMEOUT=5.0
PAGO_LATENCIA_MS=200
ADMIN_CLAVE=admin123
SECRETO=f822e881_super_secret_jwt_key_teleticket_2026_prod
PUERTO=8000
CULQI_LLAVE_PUBLICA=pk_live_cqeIUMjPyHVgpBcx
CULQI_LLAVE_PRIVADA=sk_test_Y3d18LZ4e6rZ0eL9
EOF

echo ">>> 6. Desplegando Postgres y Backend Go con Docker Compose..."
docker compose down -v 2>/dev/null || true
docker compose up -d --build

echo "=========================================================================="
echo ">>> Servidor Tiquetera desplegado con exito en http://$(curl -s ifconfig.me):8000"
echo "=========================================================================="

