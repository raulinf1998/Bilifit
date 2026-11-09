# Despliegue de Bilifit en Proxmox VE (`192.168.1.47`)

Tienes **3 formas sencillas** de desplegar Bilifit en tu contenedor de Proxmox con la IP **`192.168.1.47`**:

---

## Opción 1 (Recomendada): Contenedor LXC nativo (ligero, ~150 MB de RAM)

### A) Si ya has creado el contenedor LXC en Proxmox con IP `192.168.1.47`
Entra en la consola del contenedor (Debian 12 o Ubuntu 22.04/24.04) y ejecuta como `root`:

```bash
apt-get update && apt-get install -y curl git
git clone https://github.com/raulinf1998/Bilifit.git /opt/bilifit
# Si aún no has fusionado el PR a main, cambia a la rama del proyecto:
[ -f /opt/bilifit/package.json ] || git -C /opt/bilifit checkout arena/de7142dc-bilifit
bash /opt/bilifit/deploy/proxmox/install-lxc.sh
```

Esto instalará automáticamente Node.js 22, compilará Bilifit en producción, configurará el servicio `systemd` (`bilifit.service`) con la base de datos persistente en `/opt/bilifit/data/bilifit.db` y activará **Nginx en el puerto 80**.

Cuando termine, abre en tu navegador:
- **`http://192.168.1.47`** (o `http://192.168.1.47:3000`)

> Si prefieres exponer **solo** el puerto `3000` sin Nginx, añade `--no-nginx` al final del comando.

---

### B) Si quieres crear el contenedor LXC desde el shell de Proxmox VE
Desde el shell del host Proxmox (`root@pve`), puedes revisar las variables (por defecto usa puente `vmbr0`, gateway `192.168.1.1`, almacenamiento `local-lvm`, 2 vCPU, 2 GB RAM, 8 GB disco e IP `192.168.1.47/24`):

```bash
curl -fsSL https://raw.githubusercontent.com/raulinf1998/Bilifit/arena/de7142dc-bilifit/deploy/proxmox/create-proxmox-lxc.sh -o create-proxmox-lxc.sh
LXC_GW=192.168.1.1 LXC_BRIDGE=vmbr0 LXC_STORAGE=local-lvm bash create-proxmox-lxc.sh
```

---

## Opción 2: Contenedor Docker / Docker Compose (dentro de LXC o VM en `192.168.1.47`)

> Nota en Proxmox LXC: si corres Docker dentro de un contenedor LXC, activa **Nesting (`nesting=1`)** en *Opciones → Características* del contenedor en Proxmox.

1. Clona el repositorio y entra en la carpeta:
   ```bash
   git clone https://github.com/raulinf1998/Bilifit.git /opt/bilifit
   cd /opt/bilifit
   [ -f package.json ] || git checkout arena/de7142dc-bilifit
   ```
2. (Opcional) Si quieres entrar directo por **`http://192.168.1.47`** (puerto `80`) en vez de `:3000`:
   ```bash
   cp .env.example .env
   sed -i 's/^BILIFIT_PORT=.*/BILIFIT_PORT=80/' .env
   ```
3. Construye y levanta el contenedor:
   ```bash
   docker compose up -d --build
   ```

La base de datos SQLite quedará guardada fuera del contenedor en **`/opt/bilifit/data/bilifit.db`**, por lo que no perderás ningún dato al actualizar o recrear el contenedor.

---

## Configurar Strava en `192.168.1.47` (Opcional)

1. Abre **`http://192.168.1.47/strava`** (o `:3000/strava`).
2. En [strava.com/settings/api](https://www.strava.com/settings/api), configura **Authorization Callback Domain** con:
   ```text
   192.168.1.47
   ```
3. Introduce tu `Client ID` y `Client Secret` directamente en la web de Bilifit (o en `/opt/bilifit/.env`).
4. Si no tienes suscripción API de Strava, puedes subir archivos `.fit`, `.gpx` (MyWhoosh), `.tcx` o tu `.zip` de exportación de Strava directamente en `/strava` o `/ciclismo` (Nginx admite subidas de hasta **100 MB**).

---

## Mantenimiento y Copias de Seguridad

- **Ver logs (LXC nativo)**: `journalctl -u bilifit -f`
- **Ver logs (Docker)**: `docker compose logs -f bilifit`
- **Actualizar Bilifit (LXC nativo)**:
  ```bash
  bash /opt/bilifit/deploy/proxmox/install-lxc.sh
  ```
- **Actualizar Bilifit (Docker)**:
  ```bash
  cd /opt/bilifit && git pull && docker compose up -d --build
  ```
- **Backup**: además de los snapshots/backups de Proxmox (PBS/vzdump), todos tus entrenamientos, rutas y rutinas viven en un único archivo:
  `/opt/bilifit/data/bilifit.db`
