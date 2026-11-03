#!/bin/bash
set -e

# ==============================================================================
# Vultr Startup Script: Atacante / Generador de Carga (Ubuntu 24.04 LTS)
# Optimiza kernel TCP, instala k6, Python httpx y clona el repositorio.
# ==============================================================================

export DEBIAN_FRONTEND=noninteractive

echo ">>> 1. Actualizando sistema y paquetes de red..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw htop tmux python3 python3-pip python3-venv ca-certificates gnupg jq

echo ">>> 2. Configurando Firewall UFW..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp  # SSH
ufw --force enable

echo ">>> 3. Optimizando Kernel Linux para Concurrencia Extrema..."
cat << 'EOF' > /etc/sysctl.d/99-high-concurrency.conf
# Capacidad maxima de descriptores de socket
fs.file-max = 2097152

# Rango completo de puertos efimeros locales
net.ipv4.ip_local_port_range = 1024 65535

# Reuso rapido de sockets en estado TIME_WAIT
net.ipv4.tcp_tw_reuse = 1

# Colas de conexion del kernel
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.core.netdev_max_backlog = 65535
EOF

sysctl --system

# Limites de descriptores de archivo por proceso
cat << 'EOF' >> /etc/security/limits.conf
* soft nofile 65535
* hard nofile 65535
root soft nofile 65535
root hard nofile 65535
EOF

ulimit -n 65535

echo ">>> 4. Instalando k6 oficial para Ubuntu 24.04 (Noble)..."
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://dl.k6.io/key.gpg | gpg --dearmor -o /etc/apt/keyrings/k6-archive-keyring.gpg
chmod a+r /etc/apt/keyrings/k6-archive-keyring.gpg

echo "deb [signed-by=/etc/apt/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
    | tee /etc/apt/sources.list.d/k6.list > /dev/null

apt-get update
apt-get install -y k6

echo ">>> 5. Clonando repositorio del proyecto..."
cd /root
if [ -d "/root/pasarela-entradas" ]; then
    cd /root/pasarela-entradas
    git fetch origin
    git reset --hard origin/main
else
    git clone https://github.com/joseantoniohg26/pasarela-entradas.git
    cd /root/pasarela-entradas
fi

echo ">>> 6. Configurando entorno virtual Python con httpx..."
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install httpx

echo "=========================================================================="
echo ">>> Atacante / Generador de Carga listo para ejecutar pruebas"
echo "=========================================================================="
