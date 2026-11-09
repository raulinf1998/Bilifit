#!/usr/bin/env bash
set -euo pipefail

# Instalador automático de Bilifit para contenedor LXC en Proxmox (Debian 12 / Ubuntu 22.04-24.04)
# Uso:
#   bash install-lxc.sh                -> Instalación nativa + systemd + Nginx en puerto 80 (http://192.168.1.47)
#   bash install-lxc.sh --no-nginx     -> Solo Bilifit en puerto 3000 (http://192.168.1.47:3000)
#   bash install-lxc.sh --docker       -> Instala Docker + Docker Compose y levanta el contenedor

REPO_URL="${BILIFIT_REPO_URL:-https://github.com/raulinf1998/Bilifit.git}"
INSTALL_DIR="${BILIFIT_DIR:-/opt/bilifit}"
BRANCH="${BILIFIT_BRANCH:-}"
USE_NGINX=1
USE_DOCKER=0
CONTAINER_IP="${BILIFIT_IP:-192.168.1.47}"

for arg in "$@"; do
  case "$arg" in
    --no-nginx) USE_NGINX=0 ;;
    --docker) USE_DOCKER=1 ;;
    --help|-h)
      echo "Uso: $0 [--no-nginx] [--docker]"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg"
      exit 1
      ;;
  esac
done

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: ejecuta este script como root dentro del contenedor LXC."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo "=== [1/6] Actualizando paquetes base ==="
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg git sqlite3

clone_or_update_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    echo "Actualizando repositorio existente en $INSTALL_DIR..."
    git -C "$INSTALL_DIR" fetch origin --prune
    if [ -n "$BRANCH" ]; then
      git -C "$INSTALL_DIR" checkout "$BRANCH"
      git -C "$INSTALL_DIR" pull --ff-only origin "$BRANCH"
    else
      CURRENT_BRANCH="$(git -C "$INSTALL_DIR" rev-parse --abbrev-ref HEAD)"
      git -C "$INSTALL_DIR" pull --ff-only origin "$CURRENT_BRANCH" || true
    fi
  else
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone "$REPO_URL" "$INSTALL_DIR"
    if [ -n "$BRANCH" ]; then
      git -C "$INSTALL_DIR" checkout "$BRANCH"
    elif [ ! -f "$INSTALL_DIR/package.json" ]; then
      # Si aún no se ha fusionado el PR a main, usar la rama de Bilifit
      git -C "$INSTALL_DIR" checkout arena/de7142dc-bilifit
    fi
  fi
}

if [ "$USE_DOCKER" -eq 1 ]; then
  echo "=== [2/6] Instalando Docker Engine y Compose plugin ==="
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker

  echo "=== [3/6] Descargando Bilifit en $INSTALL_DIR ==="
  clone_or_update_repo
  cd "$INSTALL_DIR"

  mkdir -p "$INSTALL_DIR/data"
  if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    if [ "$USE_NGINX" -eq 0 ]; then
      sed -i 's/^BILIFIT_PORT=.*/BILIFIT_PORT=3000/' "$INSTALL_DIR/.env"
    else
      sed -i 's/^BILIFIT_PORT=.*/BILIFIT_PORT=80/' "$INSTALL_DIR/.env"
    fi
  fi

  echo "=== [4/6] Construyendo e iniciando contenedor Docker ==="
  docker compose up -d --build

  echo "=== ¡Listo! ==="
  PORT_ACTIVE="$(grep -E '^BILIFIT_PORT=' "$INSTALL_DIR/.env" | cut -d= -f2 || echo 3000)"
  if [ "$PORT_ACTIVE" = "80" ]; then
    echo "Bilifit disponible en: http://$CONTAINER_IP"
  else
    echo "Bilifit disponible en: http://$CONTAINER_IP:${PORT_ACTIVE:-3000}"
  fi
  exit 0
fi

echo "=== [2/6] Instalando dependencias de compilación y Node.js 22 ==="
apt-get install -y -qq build-essential python3
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | sed 's/v//' | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
echo "Node instalado: $(node -v) | npm: $(npm -v)"

echo "=== [3/6] Descargando / actualizando Bilifit en $INSTALL_DIR ==="
clone_or_update_repo

if ! id -u bilifit >/dev/null 2>&1; then
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin bilifit
fi

mkdir -p "$INSTALL_DIR/data"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  cat > "$INSTALL_DIR/.env" <<EOF
BILIFIT_DB_PATH=$INSTALL_DIR/data/bilifit.db
TZ=Europe/Madrid
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_REDIRECT_URI=
STRAVA_WEBHOOK_VERIFY_TOKEN=bilifit_webhook_token
EOF
fi

echo "=== [4/6] Instalando paquetes npm y compilando producción ==="
chown -R bilifit:bilifit "$INSTALL_DIR"
cd "$INSTALL_DIR"
su -s /bin/bash bilifit -c "npm ci && npm run build"

echo "=== [5/6] Configurando servicio systemd bilifit.service ==="
cp "$INSTALL_DIR/deploy/proxmox/bilifit.service" /etc/systemd/system/bilifit.service
systemctl daemon-reload
systemctl enable --now bilifit
systemctl restart bilifit

if [ "$USE_NGINX" -eq 1 ]; then
  echo "=== [6/6] Configurando Nginx (puerto 80 -> 3000) ==="
  apt-get install -y -qq nginx
  cp "$INSTALL_DIR/deploy/proxmox/nginx.conf" /etc/nginx/sites-available/bilifit
  ln -sf /etc/nginx/sites-available/bilifit /etc/nginx/sites-enabled/bilifit
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx
else
  echo "=== [6/6] Saltando Nginx (--no-nginx) ==="
fi

echo "Verificando salud del servidor..."
for i in $(seq 1 20); do
  if curl -fsS http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:3000/api/health && echo ""
echo ""
echo "====================================================="
echo "  Bilifit instalado correctamente en Proxmox LXC"
if [ "$USE_NGINX" -eq 1 ]; then
  echo "  URL principal: http://$CONTAINER_IP"
  echo "  Puerto directo: http://$CONTAINER_IP:3000"
else
  echo "  URL principal: http://$CONTAINER_IP:3000"
fi
echo "  Base SQLite:   $INSTALL_DIR/data/bilifit.db"
echo "  Logs servicio: journalctl -u bilifit -f"
echo "====================================================="
