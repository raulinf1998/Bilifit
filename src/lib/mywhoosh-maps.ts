export interface MyWhooshWorldDefinition {
  id: string;
  name: string;
  subtitle: string;
  regionLabel: string;
  /** [[southLat, westLon], [northLat, eastLon]] compatible con Leaflet LatLngBoundsExpression */
  bounds: [[number, number], [number, number]];
  /** Alias adicionales de bounding boxes (p. ej. Hudayriyat real vs virtual) */
  altBounds?: Array<[[number, number], [number, number]]>;
  imageUrl: string;
  backgroundColor: string;
  accentColor: string;
  routesCount: number;
  maxElevationM: number;
  landmarks: Array<{ name: string; lat: number; lon: number; eleM?: number }>;
  keywords: string[];
}

export const MYWHOOSH_WORLDS: MyWhooshWorldDefinition[] = [
  {
    id: 'hudayriyat',
    name: 'Hudayriyat',
    subtitle: 'Isla, Velódromo y Circuitos Rápidos',
    regionLabel: 'Abu Dabi · EAU',
    bounds: [
      [23.332, 54.955],
      [23.382, 54.998],
    ],
    altBounds: [
      [
        [24.395, 54.315],
        [24.445, 54.37],
      ],
    ],
    imageUrl: '/maps/mywhoosh/hudayriyat.svg',
    backgroundColor: '#b9c6c4',
    accentColor: '#06b6d4',
    routesCount: 7,
    maxElevationM: 133,
    landmarks: [
      { name: 'Velodrome', lat: 23.362, lon: 54.976, eleM: 41 },
      { name: 'Hudayriyat Ascend', lat: 23.349, lon: 54.985, eleM: 133 },
      { name: 'Octopus Loop', lat: 23.369, lon: 54.967, eleM: 20 },
    ],
    keywords: ['hudayriyat', 'octopus', 'velodrome', 'dust trail'],
  },
  {
    id: 'arabia',
    name: 'Arabia',
    subtitle: 'Desierto de Liwa, Jebel Jais y Jebel Hafeet',
    regionLabel: 'Emiratos Árabes Unidos',
    bounds: [
      [23.34, 52.16],
      [23.515, 52.278],
    ],
    imageUrl: '/maps/mywhoosh/arabia.svg',
    backgroundColor: '#cfc3ac',
    accentColor: '#f59e0b',
    routesCount: 17,
    maxElevationM: 893,
    landmarks: [
      { name: 'Jebel Jais', lat: 23.485, lon: 52.248, eleM: 893 },
      { name: 'Jebel Hafeet', lat: 23.442, lon: 52.195, eleM: 735 },
      { name: 'Yas Marina', lat: 23.372, lon: 52.225, eleM: 18 },
      { name: 'Al Wathba', lat: 23.395, lon: 52.252, eleM: 48 },
    ],
    keywords: ['arabia', 'jebel jais', 'jebel hafeet', 'al wathba', 'yas marina', 'al qudra', 'bahrain', 'arabian', 'tel moreeb'],
  },
  {
    id: 'belgium',
    name: 'Belgium',
    subtitle: 'Adoquines de Flandes y Muros Clásicos',
    regionLabel: 'Flandes · Bélgica',
    bounds: [
      [50.75, 3.458],
      [50.865, 3.605],
    ],
    imageUrl: '/maps/mywhoosh/belgium.svg',
    backgroundColor: '#b9c3b4',
    accentColor: '#10b981',
    routesCount: 7,
    maxElevationM: 177,
    landmarks: [
      { name: 'Muur van Geraardsbergen', lat: 50.774, lon: 3.576, eleM: 110 },
      { name: 'Oudenaarde', lat: 50.838, lon: 3.588, eleM: 22 },
      { name: 'Taaienberg', lat: 50.798, lon: 3.525, eleM: 84 },
      { name: 'Brujas / Flandes', lat: 50.848, lon: 3.488, eleM: 18 },
    ],
    keywords: ['belgium', 'bélgica', 'belgica', 'muur', 'oudenaarde', 'flanders', 'flandes', 'taaienberg', 'brujas', 'brussels'],
  },
  {
    id: 'colombia',
    name: 'Colombia',
    subtitle: 'Puertos Andinos y Alto de Letras',
    regionLabel: 'Cordillera de los Andes · Colombia',
    bounds: [
      [4.565, -72.868],
      [4.668, -72.755],
    ],
    imageUrl: '/maps/mywhoosh/colombia.svg',
    backgroundColor: '#b5c2b6',
    accentColor: '#eab308',
    routesCount: 11,
    maxElevationM: 1482,
    landmarks: [
      { name: 'Alto de Letras', lat: 4.648, lon: -72.785, eleM: 1482 },
      { name: 'La Línea', lat: 4.618, lon: -72.838, eleM: 1150 },
      { name: 'Valle Cafetero', lat: 4.585, lon: -72.812, eleM: 260 },
    ],
    keywords: ['colombia', 'letras', 'bogota', 'medellin', 'la linea'],
  },
  {
    id: 'alula',
    name: 'AlUla',
    subtitle: 'Cañones de Arenisca y Roca del Elefante',
    regionLabel: 'AlUla · Arabia Saudí',
    bounds: [
      [26.545, 37.72],
      [26.648, 37.808],
    ],
    imageUrl: '/maps/mywhoosh/alula.svg',
    backgroundColor: '#cfb7a1',
    accentColor: '#f97316',
    routesCount: 9,
    maxElevationM: 333,
    landmarks: [
      { name: 'Elephant Rock', lat: 26.618, lon: 37.768, eleM: 295 },
      { name: 'Hegra Oasis', lat: 26.578, lon: 37.742, eleM: 140 },
      { name: 'Canyon Overlook', lat: 26.632, lon: 37.792, eleM: 333 },
    ],
    keywords: ['alula', 'al-ula', 'hegra', 'elephant rock'],
  },
  {
    id: 'australia',
    name: 'Australia',
    subtitle: 'Costa de Queensland y Selva Tropical',
    regionLabel: 'Queensland · Australia',
    bounds: [
      [-21.035, 148.716],
      [-20.972, 148.81],
    ],
    imageUrl: '/maps/mywhoosh/australia.svg',
    backgroundColor: '#b4c5bd',
    accentColor: '#22c55e',
    routesCount: 8,
    maxElevationM: 404,
    landmarks: [
      { name: 'Rainforest Peak', lat: -20.985, lon: 148.742, eleM: 404 },
      { name: 'Coastal Boardwalk', lat: -21.02, lon: 148.792, eleM: 18 },
    ],
    keywords: ['australia', 'queensland', 'sydney'],
  },
  {
    id: 'california',
    name: 'California',
    subtitle: 'Sierra Nevada, Secuoyas y Costa Pacífica',
    regionLabel: 'California · EE. UU.',
    bounds: [
      [38.38, -120.422],
      [38.458, -120.326],
    ],
    imageUrl: '/maps/mywhoosh/california.svg',
    backgroundColor: '#bcc5b8',
    accentColor: '#ec4899',
    routesCount: 8,
    maxElevationM: 290,
    landmarks: [
      { name: 'Sierra Pass', lat: 38.44, lon: -120.355, eleM: 290 },
      { name: 'Redwood Valley', lat: 38.402, lon: -120.398, eleM: 92 },
    ],
    keywords: ['california', 'yosemite', 'redwood', 'sierra'],
  },
  {
    id: 'japan',
    name: 'Japan',
    subtitle: 'Monte Fuji, Templos y Lagos de Kioto',
    regionLabel: 'Honshu · Japón',
    bounds: [
      [35.402, 135.098],
      [35.482, 135.188],
    ],
    imageUrl: '/maps/mywhoosh/japan.svg',
    backgroundColor: '#bcc2c7',
    accentColor: '#f43f5e',
    routesCount: 7,
    maxElevationM: 958,
    landmarks: [
      { name: 'Mount Fuji', lat: 35.466, lon: 135.158, eleM: 958 },
      { name: 'Kyoto Shrine', lat: 35.422, lon: 135.125, eleM: 120 },
    ],
    keywords: ['japan', 'japón', 'japon', 'fuji', 'kyoto'],
  },
  {
    id: 'mywhoosh-world',
    name: 'MyWhoosh World',
    subtitle: 'Isla Central y Circuito de Campeonatos',
    regionLabel: 'Isla Virtual · MyWhoosh',
    bounds: [
      [24.965, -71.038],
      [25.022, -70.97],
    ],
    imageUrl: '/maps/mywhoosh/mywhoosh-world.svg',
    backgroundColor: '#b3c4c9',
    accentColor: '#38bdf8',
    routesCount: 8,
    maxElevationM: 692,
    landmarks: [
      { name: 'Championship Arena', lat: 24.992, lon: -71.005, eleM: 45 },
      { name: 'Endurance Climb', lat: 25.012, lon: -70.985, eleM: 692 },
    ],
    keywords: ['mywhoosh world', 'mywhooshworld', 'championship'],
  },
  {
    id: 'switzerland',
    name: 'Switzerland',
    subtitle: 'Zúrich y Puertos Alpinos',
    regionLabel: 'Suiza · Alpes',
    bounds: [
      [47.34, 8.48],
      [47.41, 8.59],
    ],
    imageUrl: '/maps/mywhoosh/switzerland.svg',
    backgroundColor: '#bcc7c9',
    accentColor: '#ef4444',
    routesCount: 6,
    maxElevationM: 880,
    landmarks: [
      { name: 'Zúrich Circuito', lat: 47.375, lon: 8.54, eleM: 466 },
      { name: 'Alpine Climb', lat: 47.396, lon: 8.508, eleM: 880 },
    ],
    keywords: ['switzerland', 'suiza', 'zurich', 'zürich'],
  },
  {
    id: 'bhutan',
    name: 'Bhutan',
    subtitle: 'Valles del Himalaya y Paso Dochula',
    regionLabel: 'Bután · Himalaya',
    bounds: [
      [27.44, 89.6],
      [27.52, 89.7],
    ],
    imageUrl: '/maps/mywhoosh/bhutan.svg',
    backgroundColor: '#c0c4bd',
    accentColor: '#a855f7',
    routesCount: 5,
    maxElevationM: 1620,
    landmarks: [
      { name: 'Dochula Pass', lat: 27.492, lon: 89.665, eleM: 1620 },
      { name: 'Thimphu Valley', lat: 27.466, lon: 89.632, eleM: 410 },
    ],
    keywords: ['bhutan', 'bután', 'butan', 'dochula', 'thimphu'],
  },
];

function pointInBounds(lat: number, lon: number, bounds: [[number, number], [number, number]], margin = 0.04): boolean {
  const [[south, west], [north, east]] = bounds;
  return lat >= south - margin && lat <= north + margin && lon >= west - margin && lon <= east + margin;
}

export function getMyWhooshWorldByIdOrName(name?: string | null): MyWhooshWorldDefinition | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  return MYWHOOSH_WORLDS.find(
    (w) =>
      w.id === lower ||
      w.name.toLowerCase() === lower ||
      w.keywords.some((kw) => lower.includes(kw))
  );
}

/**
 * Detecta el mundo de MyWhoosh a partir de coordenadas GPS (estilo Dreeve ZwiftMap::forStartingCoordinate)
 * o bien por nombre de mundo/título de actividad.
 */
export function resolveMyWhooshWorldForActivity(params: {
  worldName?: string | null;
  title?: string | null;
  coords?: Array<[number, number]>;
}): { world: MyWhooshWorldDefinition; bounds: [[number, number], [number, number]] } | null {
  const { worldName, title, coords = [] } = params;

  // 1. Detección exacta por coordenadas GPS de la traza
  if (coords.length > 0) {
    const [lat, lon] = coords[0];
    for (const world of MYWHOOSH_WORLDS) {
      if (pointInBounds(lat, lon, world.bounds, 0.02)) {
        return { world, bounds: world.bounds };
      }
      if (world.altBounds) {
        for (const ab of world.altBounds) {
          if (pointInBounds(lat, lon, ab, 0.02)) {
            return { world, bounds: ab };
          }
        }
      }
    }
  }

  // 2. Detección por nombre del mundo o título
  const byName = getMyWhooshWorldByIdOrName(worldName) ?? getMyWhooshWorldByIdOrName(title);
  if (byName) {
    // Si tiene coordenadas en otro rango, ajustar el overlay al bounding box de la ruta con margen
    if (coords.length >= 2) {
      let minLat = Infinity;
      let maxLat = -Infinity;
      let minLon = Infinity;
      let maxLon = -Infinity;
      for (const [la, lo] of coords) {
        if (la < minLat) minLat = la;
        if (la > maxLat) maxLat = la;
        if (lo < minLon) minLon = lo;
        if (lo > maxLon) maxLon = lo;
      }
      const padLat = Math.max(0.012, (maxLat - minLat) * 0.35);
      const padLon = Math.max(0.015, (maxLon - minLon) * 0.35);
      return {
        world: byName,
        bounds: [
          [minLat - padLat, minLon - padLon],
          [maxLat + padLat, maxLon + padLon],
        ],
      };
    }
    return { world: byName, bounds: byName.bounds };
  }

  return null;
}
