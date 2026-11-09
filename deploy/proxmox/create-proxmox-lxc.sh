#!/usr/bin/env bash
set -euo pipefail

# Script opcional para ejecutar en el HOST Proxmox VE y crear automáticamente
# el contenedor LXC Debian 12 con IP fija 192.168.1.47 e instalar Bilifit dentro.
#
# Variables personalizables antes de ejecutar:
#   CTID=147 LXC_GW=192.168.1.1 LXC_BRIDGE=vmbr0 LXC_STORAGE=local-lvm bash create-proxmox-lxc.sh

if ! command -v pct >/dev/null 2>&1; then
  echo "Error: este script debe ejecutarse en el shell del nodo Proxmox VE (requiere 'pct')."
  exit 1
fi

CTID="${CTID:-$(pvesh get /cluster/nextid)}"
LXC_HOSTNAME="${LXC_HOSTNAME:-bilifit}"
LXC_IP="${LXC_IP:-192.168.1.47/24}"
LXC_GW="${LXC_GW:-192.168.1.1}"
LXC_DNS="${LXC_DNS:-1.1.1.1}"
LXC_BRIDGE="${LXC_BRIDGE:-vmbr0}"
LXC_STORAGE="${LXC_STORAGE:-local-lvm}"
TEMPLATE_STORAGE="${TEMPLATE_STORAGE:-local}"
LXC_CORES="${LXC_CORES:-2}"
LXC_RAM="${LXC_RAM:-2048}"
LXC_SWAP="${LXC_SWAP:-512}"
LXC_DISK="${LXC_DISK:-8}"
REPO_BRANCH="${BILIFIT_BRANCH:-}"

echo "=== Buscando plantilla Debian 12 en Proxmox ==="
pveam update >/dev/null
TEMPLATE_NAME="$(pveam available --section system | awk '/debian-12-standard/{print $2}' | sort -V | tail -n1)"
if [ -z "$TEMPLATE_NAME" ]; then
  echo "No se encontró plantilla debian-12-standard en pveam."
  exit 1
fi

if ! pveam list "$TEMPLATE_STORAGE" | grep -q "$TEMPLATE_NAME"; then
  echo "Descargando $TEMPLATE_NAME en $TEMPLATE_STORAGE..."
  pveam download "$TEMPLATE_STORAGE" "$TEMPLATE_NAME"
fi

echo "=== Creando contenedor LXC $CTID ($LXC_HOSTNAME) en $LXC_IP ==="
pct create "$CTID" "${TEMPLATE_STORAGE}:vztmpl/${TEMPLATE_NAME}" \
  --hostname "$LXC_HOSTNAME" \
  --cores "$LXC_CORES" \
  --memory "$LXC_RAM" \
  --swap "$LXC_SWAP" \
  --rootfs "${LXC_STORAGE}:${LXC_DISK}" \
  --net0 "name=eth0,bridge=${LXC_BRIDGE},ip=${LXC_IP},gw=${LXC_GW},type=veth" \
  --nameserver "$LXC_DNS" \
  --features nesting=1 \
  --unprivileged 1 \
  --onboot 1 \
  --start 1

echo "Esperando red dentro del contenedor $CTID..."
sleep 6

INSTALL_CMD="apt-get update -qq && apt-get install -y -qq curl git"
if [ -n "$REPO_BRANCH" ]; then
  INSTALL_CMD="$INSTALL_CMD && git clone -b $REPO_BRANCH https://github.com/raulinf1998/Bilifit.git /opt/bilifit && bash /opt/bilifit/deploy/proxmox/install-lxc.sh"
else
  INSTALL_CMD="$INSTALL_CMD && git clone https://github.com/raulinf1998/Bilifit.git /opt/bilifit && ( [ -f /opt/bilifit/package.json ] || git -C /opt/bilifit checkout arena/de7142dc-bilifit ) && bash /opt/bilifit/deploy/proxmox/install-lxc.sh"
fi

pct exec "$CTID" -- bash -c "$INSTALL_CMD"

echo ""
echo "¡Contenedor $CTID creado y Bilifit desplegado en http://${LXC_IP%/*} !"
