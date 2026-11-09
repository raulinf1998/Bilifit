# Bilifit

Aplicación web **open source (licencia MIT)** y autohospedable para seguimiento deportivo multideporte, diseñada específicamente para unificar:

1. **Correr**: Ritmos, cadencia, carga de entrenamiento, desgaste de zapatillas.
2. **Ciclismo Indoor con MyWhoosh**: Soporte de sesiones `VirtualRide` de Strava y archivos `.gpx` (incluyendo extensiones de potencia/cadencia/FC de MyWhoosh 5.x) o `.fit`, con cálculo local de **Potencia Normalizada (NP), IF, TSS, W/kg, curva de potencia y zonas Coggan**.
3. **Rutas de Montaña**: Mapas topográficos (**OpenTopoMap**), perfiles de desnivel positivo/negativo, biblioteca de rutas pendientes o completadas y descarga de tracks `.gpx`.
4. **Entrenamiento en Casa según tu Material**: Inventario interactivo del material que tienes en casa (mancuernas, bandas, esterilla, barra de dominadas, kettlebell, TRX, cajón, rodillo, o material personalizado), **generador automático de rutinas** adaptado 100% a los materiales seleccionados, constructor manual de rutinas, intercambio de ejercicios compatibles y **modo sesión en vivo** con temporizador de descanso entre series.
5. **Vinculación con Strava e Importación Universal**: Conexión OAuth 2.0 + Webhooks con Strava y subida directa de archivos `.fit`, `.gpx`, `.tcx` y archivos `.zip` de exportación completa de Strava (funciona al 100% sin necesidad de pagar API de Strava).

---

## Stack Tecnológico

- **Framework**: Next.js (App Router) + React + TypeScript
- **Estilos**: Tailwind CSS (modo oscuro/claro)
- **Base de datos**: SQLite local (`better-sqlite3`, archivo `./data/bilifit.db` creado y poblado automáticamente al iniciar)
- **Mapas**: Leaflet con capas OpenTopoMap, OpenStreetMap y CartoDB
- **Parsers**: `fit-file-parser` (`.fit`), `fast-xml-parser` (`.gpx` / `.tcx`), `jszip` + `zlib` (`.zip` / `.gz`)

---

## Puesta en Marcha Rápida

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abre `http://localhost:3000`. En el primer arranque, Bilifit crea la base de datos SQLite en `./data/bilifit.db` con datos de ejemplo para que puedas explorar todas las gráficas, mapas y rutinas al instante.

### Vincular con Strava (Opcional)

1. Crea una aplicación en [strava.com/settings/api](https://www.strava.com/settings/api) (nota: desde junio de 2026 Strava exige suscripción activa para apps del *Standard Tier*).
2. Configura como *Authorization Callback Domain* tu dominio (por ejemplo `localhost` o el dominio de tu servidor).
3. Introduce tu `Client ID` y `Client Secret` en **Strava e Importar** (`/strava`) o en `.env.local` (`STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`).
4. Pulsa **Conectar con Strava** y luego **Sincronizar Actividades Ahora**.

> **Sin suscripción de Strava:** Puedes exportar tus actividades de Strava o descargar tus `.gpx` / `.fit` desde MyWhoosh o tu reloj GPS y arrastrarlos en `/strava` o `/ciclismo` sin límites.

---

### Despliegue en Proxmox VE (Contenedor LXC o Docker)

El repositorio incluye configuración lista para producción (`Dockerfile`, `docker-compose.yml` y scripts para Proxmox LXC + Nginx + systemd) preparada para servir en tu red local (por ejemplo `http://192.168.1.47`):

- **Docker Compose**: `docker compose up -d --build` (base de datos persistente en `./data/bilifit.db`).
- **Proxmox LXC nativo**: consulta la guía completa en [`deploy/proxmox/README.md`](deploy/proxmox/README.md) o ejecuta `bash deploy/proxmox/install-lxc.sh` dentro de tu contenedor Debian/Ubuntu.

---

## Scripts Disponibles

- `npm run dev`: Servidor de desarrollo en `0.0.0.0:3000`
- `npm run build`: Compilación de producción
- `npm run start`: Arranque en producción
- `npm run lint`: Verificación de tipos TypeScript (`tsc --noEmit`)
- `npm test`: Tests automáticos de parsers (GPX MyWhoosh, TCX, FIT), métricas (NP, TSS, CTL/ATL/TSB) y generador de rutinas por material
