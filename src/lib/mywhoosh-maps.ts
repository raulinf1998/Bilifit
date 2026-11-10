import roadsDataRaw from './mywhoosh-roads-data.json';

export interface MyWhooshLandmark {
  name: string;
  lat: number;
  lon: number;
  eleM?: number;
}

export interface MyWhooshWorldDefinition {
  id: string;
  name: string;
  subtitle: string;
  regionLabel: string;
  /** [[southLat, westLon], [northLat, eastLon]] compatible con Leaflet LatLngBoundsExpression */
  bounds: [[number, number], [number, number]];
  /** Alias adicionales de bounding boxes (p. ej. Hudayriyat antiguo vs real) */
  altBounds?: Array<[[number, number], [number, number]]>;
  imageUrl: string;
  svgSize: [number, number];
  backgroundColor: string;
  accentColor: string;
  routesCount: number;
  maxElevationM: number;
  mywhooshInfoId: number;
  mywhooshInfoUrl: string;
  hasRealRoadNetwork: boolean;
  /** Rutas destacadas o palabras clave oficiales del mundo */
  routes: string[];
  landmarks: MyWhooshLandmark[];
  keywords: string[];
}

interface RoadsWorldEntry {
  bounds: [[number, number], [number, number]];
  svgSize: [number, number];
  refLat?: number;
  refLon?: number;
  tracks?: Array<Array<[number, number]>>;
}

const ROADS_DATA = roadsDataRaw as unknown as {
  worlds: Record<string, RoadsWorldEntry>;
};

function metaFor(
  id: string,
  fallbackBounds: [[number, number], [number, number]]
): { bounds: [[number, number], [number, number]]; svgSize: [number, number]; hasRealRoadNetwork: boolean } {
  const entry = ROADS_DATA.worlds[id];
  if (!entry) {
    return { bounds: fallbackBounds, svgSize: [1200, 1000], hasRealRoadNetwork: false };
  }
  return {
    bounds: entry.bounds,
    svgSize: entry.svgSize,
    hasRealRoadNetwork: Array.isArray(entry.tracks) && entry.tracks.length > 0,
  };
}

export const MYWHOOSH_WORLDS: MyWhooshWorldDefinition[] = [
  {
    id: 'hudayriyat',
    name: 'Hudayriyat',
    subtitle: 'Isla, Velódromo y Hudayriyat Arcade Mode',
    regionLabel: 'Abu Dabi · EAU',
    ...metaFor('hudayriyat', [[23.33, 54.952], [23.416, 55.056]]),
    altBounds: [[[24.395, 54.315], [24.445, 54.37]]],
    imageUrl: '/maps/mywhoosh/hudayriyat.svg',
    backgroundColor: '#196f98',
    accentColor: '#06b6d4',
    routesCount: 8,
    maxElevationM: 313,
    mywhooshInfoId: 9,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/9',
    routes: [
      'Hudayriyat Inner Loop',
      'Hudayriyat Outer Loop',
      'Hudayriyat Ascend',
      'Octopus Loop',
      'Dust Trail',
      'Velodrome Sprint',
      'Palm Loop',
      'Zombie Escape',
    ],
    landmarks: [
      { name: 'Hudayriyat Summit', lat: 23.35686, lon: 54.97611, eleM: 134 },
      { name: 'Velodrome', lat: 23.36374, lon: 54.98306, eleM: 41 },
      { name: 'Hudayriyat Bridge', lat: 23.37323, lon: 54.97396 },
      { name: 'Arcade Mode Bay', lat: 23.404, lon: 55.036 },
    ],
    keywords: ['hudayriyat', 'zombie escape', 'arcade mode', 'octopus loop', 'dust trail', 'hudayriyat ascend'],
  },
  {
    id: 'alula',
    name: 'AlUla',
    subtitle: 'Cañones de Arenisca, Hegra y Roca del Elefante',
    regionLabel: 'AlUla · Arabia Saudí',
    ...metaFor('alula', [[26.543, 37.721], [26.648, 37.807]]),
    imageUrl: '/maps/mywhoosh/alula.svg',
    backgroundColor: '#e6c999',
    accentColor: '#f97316',
    routesCount: 16,
    maxElevationM: 679,
    mywhooshInfoId: 6,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/6',
    routes: [
      'Culture Ride',
      'Mission Stage 3',
      'Nomad Trail',
      'Heritage Climb',
      'Elephant Rock',
      'Hegra Loop',
      'Dome City',
      'Canyon Oasis',
      'Desert Trail',
      'Artist Alley',
    ],
    landmarks: [
      { name: 'Heritage Climb Summit', lat: 26.60838, lon: 37.76093, eleM: 333 },
      { name: 'Elephant Rock', lat: 26.59548, lon: 37.75664 },
      { name: 'Hegra', lat: 26.56892, lon: 37.74126 },
      { name: 'Nabatean Cave', lat: 26.63882, lon: 37.79069 },
      { name: 'Dome City', lat: 26.58216, lon: 37.73306 },
    ],
    keywords: [
      'alula',
      'al-ula',
      'culture ride',
      'mission stage 3',
      'hegra',
      'elephant rock',
      'heritage climb',
      'nomad trail',
      'dome city',
      'canyon oasis',
      'nabatean',
    ],
  },
  {
    id: 'arabia',
    name: 'Arabia',
    subtitle: 'Desierto de Liwa, Jebel Jais y Jebel Hafeet',
    regionLabel: 'EAU y Baréin',
    ...metaFor('arabia', [[23.334, 52.162], [23.52, 52.277]]),
    imageUrl: '/maps/mywhoosh/arabia.svg',
    backgroundColor: '#1d759b',
    accentColor: '#f59e0b',
    routesCount: 30,
    maxElevationM: 925,
    mywhooshInfoId: 1,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/1',
    routes: [
      'Jabel Hafeet',
      'Jabel Jais',
      'Al Wathba',
      'Al Qudra Loop',
      'Yas Marina Circuit',
      'Tel Moreeb',
      'Majestic Peak',
      'Silent Dunes',
      'Bahrain Loop',
      'Expo Dubai',
    ],
    landmarks: [
      { name: 'Jabel Jais', lat: 23.49834, lon: 52.18677, eleM: 925 },
      { name: 'Jabel Hafeet', lat: 23.43505, lon: 52.26749, eleM: 735 },
      { name: 'Tel Moreeb', lat: 23.44638, lon: 52.23434, eleM: 310 },
      { name: 'Yas Marina', lat: 23.39534, lon: 52.18051 },
      { name: 'Al Wathba', lat: 23.44176, lon: 52.21279 },
    ],
    keywords: [
      'arabia',
      'arabian',
      'jebel jais',
      'jabel jais',
      'jebel hafeet',
      'jabel hafeet',
      'al wathba',
      'yas marina',
      'al qudra',
      'bahrain',
      'tel moreeb',
      'silent dunes',
      'majestic peak',
      'red sands',
    ],
  },
  {
    id: 'belgium',
    name: 'Belgium',
    subtitle: 'Flandes, Ardenas, Muur y Koppenberg',
    regionLabel: 'Flandes · Bélgica',
    ...metaFor('belgium', [[50.748, 3.455], [50.867, 3.608]]),
    imageUrl: '/maps/mywhoosh/belgium.svg',
    backgroundColor: '#c6dbb0',
    accentColor: '#10b981',
    routesCount: 10,
    maxElevationM: 492,
    mywhooshInfoId: 5,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/5',
    routes: [
      'Ardennes',
      'Flanders Classics',
      'Muur van Geraardsbergen',
      'Koppenberg Loop',
      'Oude Kwaremont',
      'Paterberg',
      'Oudenaarde',
      'Bruges Loop',
      'Brussels City',
      'Ghent Loop',
    ],
    landmarks: [
      { name: 'Muur van Geraardsbergen', lat: 50.82568, lon: 3.56314, eleM: 177 },
      { name: 'Koppenberg', lat: 50.78347, lon: 3.51818, eleM: 110 },
      { name: 'Oude Kwaremont', lat: 50.77239, lon: 3.57022, eleM: 94 },
      { name: 'Oudenaarde', lat: 50.80989, lon: 3.55206 },
      { name: 'Ghent', lat: 50.78439, lon: 3.52623 },
    ],
    keywords: [
      'belgium',
      'bélgica',
      'belgica',
      'ardennes',
      'muur',
      'koppenberg',
      'oudenaarde',
      'kwaremont',
      'paterberg',
      'flanders',
      'flandes',
      'taaienberg',
      'brujas',
      'bruges',
      'ghent',
      'brussels',
    ],
  },
  {
    id: 'colombia',
    name: 'Colombia',
    subtitle: 'Cordillera Andina, Alto Limonar y Cristo Rey',
    regionLabel: 'Cordillera de los Andes · Colombia',
    ...metaFor('colombia', [[4.563, -72.87], [4.671, -72.752]]),
    imageUrl: '/maps/mywhoosh/colombia.svg',
    backgroundColor: '#b5d4a8',
    accentColor: '#eab308',
    routesCount: 13,
    maxElevationM: 1667,
    mywhooshInfoId: 4,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/4',
    routes: [
      'Alto Limonar',
      'Alto del Aguila',
      'Cristo Rey',
      'Paso De Alto',
      'Mompox City',
      'Coffee Trail',
      'Santa Fe de Antioquia',
      'Amazon Forest',
    ],
    landmarks: [
      { name: 'Alto Limonar', lat: 4.606, lon: -72.86107, eleM: 1037 },
      { name: 'Cristo Rey', lat: 4.66058, lon: -72.83998, eleM: 1482 },
      { name: 'Paso De Alto', lat: 4.59916, lon: -72.78872, eleM: 889 },
      { name: 'Alto del Aguila', lat: 4.58206, lon: -72.80656, eleM: 349 },
    ],
    keywords: [
      'colombia',
      'alto limonar',
      'alto del aguila',
      'cristo rey',
      'paso de alto',
      'mompox',
      'letras',
      'la linea',
      'guatape',
    ],
  },
  {
    id: 'australia',
    name: 'Australia',
    subtitle: 'Costa de Queensland, Cities Loop y Harbour Bridge',
    regionLabel: 'Queensland · Australia',
    ...metaFor('australia', [[-21.031, 148.717], [-20.975, 148.809]]),
    imageUrl: '/maps/mywhoosh/australia.svg',
    backgroundColor: '#196f98',
    accentColor: '#22c55e',
    routesCount: 14,
    maxElevationM: 589,
    mywhooshInfoId: 3,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/3',
    routes: [
      'Cities Loop',
      'Outerloop',
      'Mount Pleasant',
      'Mount Ousley',
      'Sydney Harbour',
      'Kangaroo Valley',
      'Wollongong',
      'Brisbane Loop',
    ],
    landmarks: [
      { name: 'Outerloop Summit', lat: -21.01266, lon: 148.76307, eleM: 404 },
      { name: 'Mount Pleasant', lat: -21.00833, lon: 148.75969, eleM: 164 },
      { name: 'Sydney Harbour Bridge', lat: -20.99875, lon: 148.73549 },
      { name: 'Wollongong', lat: -20.99804, lon: 148.77676 },
    ],
    keywords: [
      'australia',
      'cities loop',
      'queensland',
      'sydney',
      'wollongong',
      'brisbane',
      'kangaroo valley',
      'mount ousley',
      'mount pleasant',
      'parramatta',
    ],
  },
  {
    id: 'california',
    name: 'California',
    subtitle: 'Golden Gate, Alcatraz, Hollywood Hills y Sierra',
    regionLabel: 'California · EE. UU.',
    ...metaFor('california', [[38.38, -120.422], [38.457, -120.326]]),
    imageUrl: '/maps/mywhoosh/california.svg',
    backgroundColor: '#1c6d96',
    accentColor: '#ec4899',
    routesCount: 13,
    maxElevationM: 815,
    mywhooshInfoId: 10,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/10',
    routes: [
      'Golden Gate',
      'Hollywood Hills',
      'Mount Umunhum',
      'Onyx Peak',
      'Goldmine Pass',
      'Hawk Hills',
      'Alcatraz',
      'Sequoia Forest',
    ],
    landmarks: [
      { name: 'Hollywood Hills', lat: 38.44508, lon: -120.36226, eleM: 202 },
      { name: 'Mount Umunhum', lat: 38.39085, lon: -120.36856, eleM: 290 },
      { name: 'Golden Gate Bridge', lat: 38.39253, lon: -120.39084 },
      { name: 'Onyx Peak', lat: 38.41393, lon: -120.33599, eleM: 210 },
    ],
    keywords: [
      'california',
      'golden gate',
      'hollywood hills',
      'umunhum',
      'onyx peak',
      'goldmine pass',
      'alcatraz',
      'sequoia',
      'yosemite',
    ],
  },
  {
    id: 'japan',
    name: 'Japan',
    subtitle: 'Monte Fuji, Tokio Dome y Kioto',
    regionLabel: 'Honshu · Japón',
    ...metaFor('japan', [[35.403, 135.097], [35.482, 135.187]]),
    imageUrl: '/maps/mywhoosh/japan.svg',
    backgroundColor: '#1d6c94',
    accentColor: '#f43f5e',
    routesCount: 15,
    maxElevationM: 1584,
    mywhooshInfoId: 13,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/13',
    routes: [
      'Tokyo Drift',
      'Mount Fuji',
      'Kyoto City',
      'Imperial Palace',
      'Origami Village',
      'Arashiyama Bamboo',
      'Shinobi Valley',
      'Kinkaku Ji',
    ],
    landmarks: [
      { name: 'Mount Fuji', lat: 35.40904, lon: 135.10357, eleM: 1016 },
      { name: 'Tokio Dome', lat: 35.46732, lon: 135.13979 },
      { name: 'Imperial Palace', lat: 35.45458, lon: 135.15384 },
      { name: 'Kyoto City', lat: 35.4374, lon: 135.16609 },
    ],
    keywords: [
      'japan',
      'japón',
      'japon',
      'tokyo drift',
      'mount fuji',
      'kyoto',
      'imperial palace',
      'origami',
      'shinobi',
      'kinkaku',
      'arashiyama',
    ],
  },
  {
    id: 'mywhoosh-world',
    name: 'MyWhoosh World',
    subtitle: 'Isla Central, Hyperion City y Snowfall Mountain',
    regionLabel: 'Isla Virtual · MyWhoosh',
    ...metaFor('mywhoosh-world', [[24.967, -71.036], [25.019, -70.972]]),
    imageUrl: '/maps/mywhoosh/mywhoosh-world.svg',
    backgroundColor: '#186992',
    accentColor: '#38bdf8',
    routesCount: 10,
    maxElevationM: 1014,
    mywhooshInfoId: 11,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/11',
    routes: [
      'Hyperion City',
      'Snowfall Mountain',
      'Blaze Summit',
      'Crimson Sands',
      'Enchanted Forest',
      'Frostfire Station',
      'Hydropolis',
      'Twin Spires',
    ],
    landmarks: [
      { name: 'Snowfall Mountain', lat: 24.9716, lon: -71.03076, eleM: 655 },
      { name: 'Blaze Summit', lat: 25.00776, lon: -70.98016, eleM: 235 },
      { name: 'Hyperion City', lat: 24.99521, lon: -71.00613 },
      { name: 'Enchanted Forest', lat: 25.01242, lon: -71.00324 },
    ],
    keywords: [
      'mywhoosh world',
      'mywhooshworld',
      'hyperion',
      'snowfall mountain',
      'blaze summit',
      'crimson sands',
      'ecospire',
      'elysium tower',
      'frostfire',
    ],
  },
  {
    id: 'switzerland',
    name: 'Switzerland',
    subtitle: 'Zúrich, Limmat Loop, Seeblick Spin y Zürichbergstrasse',
    regionLabel: 'Zúrich · Suiza',
    ...metaFor('switzerland', [[47.314, 8.492], [47.405, 8.618]]),
    imageUrl: '/maps/mywhoosh/switzerland.svg',
    backgroundColor: '#c1d8be',
    accentColor: '#ef4444',
    routesCount: 10,
    maxElevationM: 932,
    mywhooshInfoId: 12,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/12',
    routes: [
      'Limmat Loop',
      'Seeblick Spin',
      'Zürichbergstrasse',
      'Lake Zurich Loop',
      'Alpine Valley',
    ],
    landmarks: [
      { name: 'Zürichbergstrasse', lat: 47.39444, lon: 8.52905, eleM: 466 },
      { name: 'Limmat Loop', lat: 47.345, lon: 8.548 },
      { name: 'Seeblick Spin', lat: 47.362, lon: 8.601 },
    ],
    keywords: [
      'switzerland',
      'suiza',
      'limmat loop',
      'seeblick spin',
      'zurichberg',
      'zürichberg',
      'zurich',
      'zürich',
    ],
  },
  {
    id: 'france',
    name: 'France',
    subtitle: 'Morvan, Cobbled Classic, París y Col du Galibier',
    regionLabel: 'Morvan y Alpes · Francia',
    ...metaFor('france', [[47.276, 3.862], [47.324, 3.926]]),
    imageUrl: '/maps/mywhoosh/france.svg',
    backgroundColor: '#c6dab0',
    accentColor: '#3b82f6',
    routesCount: 10,
    maxElevationM: 1930,
    mywhooshInfoId: 18,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/18',
    routes: [
      'Mission Stage 2',
      'Cobbled Classic',
      'Col du Galibier',
      'Champs-Élysées',
      'Montmartre',
      'Morvan Loop',
    ],
    landmarks: [
      { name: 'Mission Stage 2 / Morvan', lat: 47.301, lon: 3.895, eleM: 168 },
      { name: 'Circuito Clásico', lat: 47.291, lon: 3.882 },
    ],
    keywords: [
      'france',
      'francia',
      'mission stage 2',
      'cobbled classic',
      'galibier',
      'champs-elysees',
      'champs-élysées',
      'montmartre',
      'morvan',
    ],
  },
  {
    id: 'bhutan',
    name: 'Bhutan',
    subtitle: 'Himalaya, Timbu, Dragon Rae y Pele La',
    regionLabel: 'Bután · Himalaya',
    ...metaFor('bhutan', [[27.44, 89.6], [27.52, 89.7]]),
    imageUrl: '/maps/mywhoosh/bhutan.svg',
    backgroundColor: '#becfc9',
    accentColor: '#a855f7',
    routesCount: 8,
    maxElevationM: 1018,
    mywhooshInfoId: 17,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/17',
    routes: ['Dragon Rae', 'Pele La', 'Thimphu City', 'Paro Valley', 'Dochula Pass'],
    landmarks: [
      { name: 'Dragon Rae Climb', lat: 27.5, lon: 89.656, eleM: 370 },
      { name: 'Pele La Pass', lat: 27.493, lon: 89.678, eleM: 300 },
    ],
    keywords: ['bhutan', 'bután', 'butan', 'dochula', 'thimphu', 'dragon rae', 'pele la'],
  },
  {
    id: 'canada',
    name: 'Canada',
    subtitle: 'Montreal, Mount Royal y Camillien Houde',
    regionLabel: 'Quebec · Canadá',
    ...metaFor('canada', [[45.492, -73.618], [45.524, -73.574]]),
    imageUrl: '/maps/mywhoosh/canada.svg',
    backgroundColor: '#24749c',
    accentColor: '#ef4444',
    routesCount: 3,
    maxElevationM: 984,
    mywhooshInfoId: 16,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/16',
    routes: ['Mount Royal Loop', 'Camillien Houde', 'Montreal Grand Prix'],
    landmarks: [
      { name: 'Camillien Houde', lat: 45.512, lon: -73.592, eleM: 247 },
      { name: 'Avenue Pagnuelo', lat: 45.505, lon: -73.605, eleM: 60 },
    ],
    keywords: ['canada', 'canadá', 'camillien houde', 'mount royal', 'mont-royal', 'pagnuelo'],
  },
  {
    id: 'endurance-climb',
    name: 'Endurance Climb',
    subtitle: 'Ascenso Maratón de 9 Secciones (2642m D+)',
    regionLabel: 'Alta Montaña · MyWhoosh',
    ...metaFor('endurance-climb', [[25.002, -71.042], [25.062, -70.962]]),
    imageUrl: '/maps/mywhoosh/endurance-climb.svg',
    backgroundColor: '#becfc9',
    accentColor: '#a855f7',
    routesCount: 3,
    maxElevationM: 2642,
    mywhooshInfoId: 7,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/7',
    routes: ['Endurance Climb', 'Endurance 15', 'Endurance 30'],
    landmarks: [{ name: 'Cima Section 9/9', lat: 25.051, lon: -70.978, eleM: 2642 }],
    keywords: ['endurance climb', 'endurance 15', 'endurance 30'],
  },
  {
    id: 'supertri',
    name: 'Supertri',
    subtitle: 'Circuito Urbano de Triatlón e Indoor Racing',
    regionLabel: 'Supertri E · MyWhoosh',
    ...metaFor('supertri', [[24.398, 54.328], [24.432, 54.372]]),
    imageUrl: '/maps/mywhoosh/supertri.svg',
    backgroundColor: '#196f98',
    accentColor: '#06b6d4',
    routesCount: 2,
    maxElevationM: 57,
    mywhooshInfoId: 14,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/14',
    routes: ['Supertri E Lap', 'Supertri Bike Course'],
    landmarks: [{ name: 'Supertri E Lap', lat: 24.421, lon: 54.351, eleM: 20 }],
    keywords: ['supertri', 'supertri e'],
  },
  {
    id: 'uci-2024',
    name: 'UCI 2024',
    subtitle: 'Campeonato Mundial UCI Cycling Esports 2024',
    regionLabel: 'UCI Esports 2024 · Abu Dabi',
    ...metaFor('uci-2024', [[24.44, 54.35], [24.49, 54.42]]),
    imageUrl: '/maps/mywhoosh/uci-2024.svg',
    backgroundColor: '#22729c',
    accentColor: '#38bdf8',
    routesCount: 3,
    maxElevationM: 432,
    mywhooshInfoId: 8,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/8',
    routes: ['UCI 2024 Stage 1', 'UCI 2024 Stage 2', 'UCI 2024 Stage 3'],
    landmarks: [{ name: 'Stage 2 Climb', lat: 24.476, lon: 54.376, eleM: 203 }],
    keywords: ['uci 2024', 'uci cycling esports 2024', 'uci esports 2024'],
  },
  {
    id: 'uci-2025',
    name: 'UCI 2025',
    subtitle: 'Campeonato Mundial UCI Cycling Esports 2025',
    regionLabel: 'UCI Esports 2025 · Abu Dabi',
    ...metaFor('uci-2025', [[24.5, 54.4], [24.55, 54.47]]),
    imageUrl: '/maps/mywhoosh/uci-2025.svg',
    backgroundColor: '#b5d4a8',
    accentColor: '#38bdf8',
    routesCount: 3,
    maxElevationM: 751,
    mywhooshInfoId: 15,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/15',
    routes: ["The Mountain's Verdict", "Sprinter's Paradise", 'UCI 2025 Stage 1'],
    landmarks: [{ name: "The Mountain's Verdict", lat: 24.536, lon: 54.454, eleM: 751 }],
    keywords: ['uci 2025', 'uci esports 2025', "mountain's verdict", "sprinter's paradise"],
  },
  {
    id: 'uci-2026',
    name: 'UCI 2026',
    subtitle: 'Pearl District & Horizon District (UCI 2026)',
    regionLabel: 'UCI Esports 2026 · MyWhoosh',
    ...metaFor('uci-2026', [[24.56, 54.45], [24.61, 54.52]]),
    imageUrl: '/maps/mywhoosh/uci-2026.svg',
    backgroundColor: '#186992',
    accentColor: '#38bdf8',
    routesCount: 3,
    maxElevationM: 142,
    mywhooshInfoId: 21,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/21',
    routes: ['Pearl District', 'Horizon District', 'UCI 2026 Stage 3'],
    landmarks: [{ name: 'Pearl District', lat: 24.596, lon: 54.473, eleM: 98 }],
    keywords: ['uci 2026', 'uci esports 2026', 'pearl district', 'horizon district'],
  },
  {
    id: 'bled',
    name: 'Bled',
    subtitle: 'Lago Bled · Eslovenia (Circuito Remo MyWhoosh)',
    regionLabel: 'Bled · Eslovenia',
    ...metaFor('bled', [[46.355, 14.075], [46.375, 14.115]]),
    imageUrl: '/maps/mywhoosh/bled.svg',
    backgroundColor: '#22729c',
    accentColor: '#0ea5e9',
    routesCount: 1,
    maxElevationM: 5,
    mywhooshInfoId: 20,
    mywhooshInfoUrl: 'https://mywhooshinfo.com/routes/world/20',
    routes: ['Lake Bled 10km'],
    landmarks: [{ name: 'Isla de Bled', lat: 46.3646, lon: 14.0942 }],
    keywords: ['lake bled', 'lago bled', 'mywhoosh bled'],
  },
];

function keywordMatchesText(lowerText: string, kw: string): boolean {
  if (kw.length <= 5 && /^[a-z0-9]+$/i.test(kw)) {
    return new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lowerText);
  }
  return lowerText.includes(kw);
}

export function pointInBounds(
  lat: number,
  lon: number,
  bounds: [[number, number], [number, number]],
  margin = 0.02
): boolean {
  const [[south, west], [north, east]] = bounds;
  return lat >= south - margin && lat <= north + margin && lon >= west - margin && lon <= east + margin;
}

export function getMyWhooshWorldByIdOrName(name?: string | null): MyWhooshWorldDefinition | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase().trim();
  // Exact ID or exact world name wins immediately
  const exact = MYWHOOSH_WORLDS.find((w) => w.id === lower || w.name.toLowerCase() === lower);
  if (exact) return exact;

  // Otherwise choose the world with the longest specific keyword/route match
  let bestWorld: MyWhooshWorldDefinition | undefined;
  let bestScore = 0;
  for (const w of MYWHOOSH_WORLDS) {
    for (const rt of w.routes) {
      const rtl = rt.toLowerCase();
      if (lower.includes(rtl) && rtl.length > bestScore) {
        bestScore = rtl.length;
        bestWorld = w;
      }
    }
    for (const kw of w.keywords) {
      if (keywordMatchesText(lower, kw) && kw.length > bestScore) {
        bestScore = kw.length;
        bestWorld = w;
      }
    }
  }
  return bestWorld;
}

/** Señales fiables de que una actividad pertenece a MyWhoosh / ciclismo virtual */
export function isMyWhooshContext(params: {
  sport?: string | null;
  subSport?: string | null;
  worldName?: string | null;
  title?: string | null;
  deviceName?: string | null;
}): boolean {
  if (params.sport === 'mywhoosh') return true;
  if (params.worldName && params.worldName.trim().length > 0) return true;
  if (params.subSport === 'virtual_activity') return true;
  if (params.deviceName && /mywhoosh/i.test(params.deviceName)) return true;
  if (params.title) {
    const t = params.title.toLowerCase();
    if (t.includes('mywhoosh')) return true;
    // Rutas inequívocamente virtuales de MyWhoosh incluso si Strava omite prefijo "MyWhoosh -"
    if (
      [
        'hudayriyat',
        'culture ride',
        'zombie escape',
        'arcade mode',
        'limmat loop',
        'seeblick spin',
        'tokyo drift',
        'cities loop',
        'mission stage 2',
        'mission stage 3',
        'endurance climb',
        'supertri',
        'snowfall mountain',
        'hyperion city',
        'alto limonar',
        'uci esports 202',
        'uci cycling esports',
      ].some((kw) => t.includes(kw))
    ) {
      return true;
    }
  }
  return false;
}

// ---------- Motor de alineación rígida 2D (punto-a-segmento sobre carreteras reales MyWhoosh) ----------

interface LocalXY {
  x: number;
  y: number;
}

interface SegBox {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  len2: number;
}

interface CompiledWorldNetwork {
  refLat: number;
  refLon: number;
  kx: number;
  ky: number;
  segs: SegBox[];
}

const COMPILED_NETWORK_CACHE = new Map<string, CompiledWorldNetwork | null>();

function toLocalXY(lat: number, lon: number, refLat: number, refLon: number): LocalXY {
  const kx = 111320 * Math.cos((refLat * Math.PI) / 180);
  const ky = 111320;
  return { x: (lon - refLon) * kx, y: (lat - refLat) * ky };
}

function fromLocalXY(x: number, y: number, refLat: number, refLon: number): [number, number] {
  const kx = 111320 * Math.cos((refLat * Math.PI) / 180);
  const ky = 111320;
  return [refLat + y / ky, refLon + x / kx];
}

function getCompiledNetwork(worldId: string): CompiledWorldNetwork | null {
  if (COMPILED_NETWORK_CACHE.has(worldId)) {
    return COMPILED_NETWORK_CACHE.get(worldId) ?? null;
  }
  const entry = ROADS_DATA.worlds[worldId];
  if (!entry || !entry.tracks || entry.tracks.length === 0 || entry.refLat == null || entry.refLon == null) {
    COMPILED_NETWORK_CACHE.set(worldId, null);
    return null;
  }
  const { refLat, refLon } = entry;
  const kx = 111320 * Math.cos((refLat * Math.PI) / 180);
  const ky = 111320;
  const segs: SegBox[] = [];
  for (const tr of entry.tracks) {
    for (let i = 0; i < tr.length - 1; i++) {
      const a = tr[i];
      const b = tr[i + 1];
      const ax = (a[1] - refLon) * kx;
      const ay = (a[0] - refLat) * ky;
      const bx = (b[1] - refLon) * kx;
      const by = (b[0] - refLat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      segs.push({
        ax,
        ay,
        bx,
        by,
        minX: ax < bx ? ax : bx,
        maxX: ax > bx ? ax : bx,
        minY: ay < by ? ay : by,
        maxY: ay > by ? ay : by,
        len2,
      });
    }
  }
  const compiled: CompiledWorldNetwork = { refLat, refLon, kx, ky, segs };
  COMPILED_NETWORK_CACHE.set(worldId, compiled);
  return compiled;
}

function samplePointsEvenly(coords: Array<[number, number]>, maxCount = 56): Array<[number, number]> {
  if (coords.length <= maxCount) return coords;
  const out: Array<[number, number]> = [];
  for (let i = 0; i < maxCount; i++) {
    const idx = Math.floor((i * (coords.length - 1)) / (maxCount - 1));
    out.push(coords[idx]);
  }
  return out;
}

function pointToSegDistSq(px: number, py: number, s: SegBox): number {
  if (s.len2 === 0) {
    const dx = px - s.ax;
    const dy = py - s.ay;
    return dx * dx + dy * dy;
  }
  const tRaw = ((px - s.ax) * (s.bx - s.ax) + (py - s.ay) * (s.by - s.ay)) / s.len2;
  const t = tRaw < 0 ? 0 : tRaw > 1 ? 1 : tRaw;
  const projX = s.ax + t * (s.bx - s.ax);
  const projY = s.ay + t * (s.by - s.ay);
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

function evalRmsSq(
  sampleLocal: LocalXY[],
  segs: SegBox[],
  dx: number,
  dy: number,
  bestLimitSq: number,
  clipDistSq = Infinity
): number {
  let sum = 0;
  const n = sampleLocal.length;
  const maxSum = bestLimitSq * n;
  for (let i = 0; i < n; i++) {
    const px = sampleLocal[i].x + dx;
    const py = sampleLocal[i].y + dy;
    let bestD2 = Infinity;
    for (let j = 0; j < segs.length; j++) {
      const s = segs[j];
      // AABB pruning avoids square-root/projection on far segments
      const ox = px < s.minX ? s.minX - px : px > s.maxX ? px - s.maxX : 0;
      if (ox * ox >= bestD2) continue;
      const oy = py < s.minY ? s.minY - py : py > s.maxY ? py - s.maxY : 0;
      if (ox * ox + oy * oy >= bestD2) continue;
      const d2 = pointToSegDistSq(px, py, s);
      if (d2 < bestD2) bestD2 = d2;
    }
    sum += bestD2 > clipDistSq ? clipDistSq : bestD2;
    if (sum > maxSum) return Infinity;
  }
  return sum / n;
}

function evalPointQuantilesM(
  sampleCoords: Array<[number, number]>,
  net: CompiledWorldNetwork,
  sol: RigidSolution
): { medianM: number; p70M: number } {
  const cos = Math.cos(sol.thetaRad);
  const sin = Math.sin(sol.thetaRad);
  const dists: number[] = [];
  for (const [la, lo] of sampleCoords) {
    const p = toLocalXY(la, lo, net.refLat, net.refLon);
    const px = (p.x - sol.cX) * cos - (p.y - sol.cY) * sin + sol.dx;
    const py = (p.x - sol.cX) * sin + (p.y - sol.cY) * cos + sol.dy;
    let bestD2 = Infinity;
    for (let j = 0; j < net.segs.length; j++) {
      const s = net.segs[j];
      const ox = px < s.minX ? s.minX - px : px > s.maxX ? px - s.maxX : 0;
      if (ox * ox >= bestD2) continue;
      const oy = py < s.minY ? s.minY - py : py > s.maxY ? py - s.maxY : 0;
      if (ox * ox + oy * oy >= bestD2) continue;
      const d2 = pointToSegDistSq(px, py, s);
      if (d2 < bestD2) bestD2 = d2;
    }
    dists.push(Math.sqrt(bestD2));
  }
  dists.sort((a, b) => a - b);
  const medianM = dists[Math.floor(dists.length * 0.5)] ?? Infinity;
  const p70M = dists[Math.floor(dists.length * 0.7)] ?? Infinity;
  return { medianM, p70M };
}

interface RigidSolution {
  rmsM: number;
  thetaRad: number;
  dx: number;
  dy: number;
  cX: number;
  cY: number;
}

function solveRigidForNetwork(
  net: CompiledWorldNetwork,
  sampleCoords: Array<[number, number]>,
  testRotations: boolean,
  clipDistSq = Infinity
): RigidSolution | null {
  if (sampleCoords.length < 3 || net.segs.length === 0) return null;

  // Convert sample points into local meter frame around their own centroid
  const rawPts = sampleCoords.map(([la, lo]) => toLocalXY(la, lo, net.refLat, net.refLon));
  let cX = 0;
  let cY = 0;
  for (const p of rawPts) {
    cX += p.x;
    cY += p.y;
  }
  cX /= rawPts.length;
  cY /= rawPts.length;
  const centered = rawPts.map((p) => ({ x: p.x - cX, y: p.y - cY }));

  // Bounding box of target road network in meters
  let tMinX = Infinity;
  let tMaxX = -Infinity;
  let tMinY = Infinity;
  let tMaxY = -Infinity;
  for (const s of net.segs) {
    if (s.minX < tMinX) tMinX = s.minX;
    if (s.maxX > tMaxX) tMaxX = s.maxX;
    if (s.minY < tMinY) tMinY = s.minY;
    if (s.maxY > tMaxY) tMaxY = s.maxY;
  }

  let best: RigidSolution = { rmsM: Infinity, thetaRad: 0, dx: 0, dy: 0, cX, cY };
  const anglesDeg = testRotations ? [0, 90, -90, 180, -30, 30, -45, 45] : [0];

  for (const deg of anglesDeg) {
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rot =
      deg === 0
        ? centered
        : centered.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));

    let startX: number;
    let endX: number;
    let startY: number;
    let endY: number;

    if (clipDistSq < Infinity) {
      const xs = rot.map((p) => p.x).sort((a, b) => a - b);
      const ys = rot.map((p) => p.y).sort((a, b) => a - b);
      const iLo = Math.floor((xs.length - 1) * 0.2);
      const iHi = Math.floor((xs.length - 1) * 0.8);
      const iMed = Math.floor((xs.length - 1) * 0.5);
      startX = tMinX - xs[iLo] - 600;
      endX = tMaxX - xs[iHi] + 600;
      if (startX > endX) {
        startX = tMinX - xs[iMed] - 600;
        endX = tMaxX - xs[iMed] + 600;
      }
      startY = tMinY - ys[iLo] - 600;
      endY = tMaxY - ys[iHi] + 600;
      if (startY > endY) {
        startY = tMinY - ys[iMed] - 600;
        endY = tMaxY - ys[iMed] + 600;
      }
    } else {
      let pMinX = Infinity;
      let pMaxX = -Infinity;
      let pMinY = Infinity;
      let pMaxY = -Infinity;
      for (const p of rot) {
        if (p.x < pMinX) pMinX = p.x;
        if (p.x > pMaxX) pMaxX = p.x;
        if (p.y < pMinY) pMinY = p.y;
        if (p.y > pMaxY) pMaxY = p.y;
      }
      startX = tMinX - pMinX - 250;
      endX = tMaxX - pMaxX + 250;
      startY = tMinY - pMinY - 250;
      endY = tMaxY - pMaxY + 250;
    }

    if (startX > endX || startY > endY) continue;

    let bestMeanSq = best.rmsM * best.rmsM;
    let bestDx = 0;
    let bestDy = 0;
    let foundAngle = false;

    const coarseStep = 280;
    for (let dx = startX; dx <= endX; dx += coarseStep) {
      for (let dy = startY; dy <= endY; dy += coarseStep) {
        const m2 = evalRmsSq(rot, net.segs, dx, dy, bestMeanSq, clipDistSq);
        if (m2 < bestMeanSq) {
          bestMeanSq = m2;
          bestDx = dx;
          bestDy = dy;
          foundAngle = true;
        }
      }
    }

    if (!foundAngle) continue;

    // Multi-scale coordinate refinement down to 1.5m precision
    for (const step of [110, 40, 14, 4, 1.5]) {
      let improved = true;
      let iter = 0;
      while (improved && iter < 12) {
        improved = false;
        iter++;
        for (const [ox, oy] of [
          [step, 0],
          [-step, 0],
          [0, step],
          [0, -step],
          [step, step],
          [-step, -step],
        ]) {
          const m2 = evalRmsSq(rot, net.segs, bestDx + ox, bestDy + oy, bestMeanSq, clipDistSq);
          if (m2 < bestMeanSq) {
            bestMeanSq = m2;
            bestDx += ox;
            bestDy += oy;
            improved = true;
          }
        }
      }
    }

    const rmsM = Math.sqrt(bestMeanSq);
    if (rmsM < best.rmsM) {
      best = { rmsM, thetaRad: rad, dx: bestDx, dy: bestDy, cX, cY };
      if (rmsM <= 18) break;
    }
  }

  return Number.isFinite(best.rmsM) ? best : null;
}

function applyRigidSolution(
  coords: Array<[number, number]>,
  net: CompiledWorldNetwork,
  sol: RigidSolution
): Array<[number, number]> {
  const cos = Math.cos(sol.thetaRad);
  const sin = Math.sin(sol.thetaRad);
  return coords.map(([la, lo]) => {
    const p = toLocalXY(la, lo, net.refLat, net.refLon);
    const rx = (p.x - sol.cX) * cos - (p.y - sol.cY) * sin + sol.dx;
    const ry = (p.x - sol.cX) * sin + (p.y - sol.cY) * cos + sol.dy;
    const [outLat, outLon] = fromLocalXY(rx, ry, net.refLat, net.refLon);
    return [Number(outLat.toFixed(6)), Number(outLon.toFixed(6))];
  });
}

function centerCoordsInBounds(
  coords: Array<[number, number]>,
  bounds: [[number, number], [number, number]]
): Array<[number, number]> {
  if (coords.length === 0) return coords;
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
  const [[south, west], [north, east]] = bounds;
  const targetCenterLat = (south + north) / 2;
  const targetCenterLon = (west + east) / 2;
  const curCenterLat = (minLat + maxLat) / 2;
  const curCenterLon = (minLon + maxLon) / 2;

  const latSpan = Math.max(1e-5, maxLat - minLat);
  const lonSpan = Math.max(1e-5, maxLon - minLon);
  const availLat = (north - south) * 0.68;
  const availLon = (east - west) * 0.68;
  const scale = Math.min(1, availLat / latSpan, availLon / lonSpan);

  return coords.map(([la, lo]) => [
    Number((targetCenterLat + (la - curCenterLat) * scale).toFixed(6)),
    Number((targetCenterLon + (lo - curCenterLon) * scale).toFixed(6)),
  ]);
}

export type AlignmentMode = 'native' | 'rigid-road-lock' | 'centered';

export interface AlignedMyWhooshTrace {
  mode: AlignmentMode;
  alignedCoords: Array<[number, number]>;
  rmsErrorM: number | null;
  rotationDeg: number;
  isApproximate: boolean;
}

const ALIGNMENT_CACHE = new Map<string, AlignedMyWhooshTrace>();

/**
 * Alinea una traza GPS completa al marco calibrado del mundo MyWhoosh seleccionado.
 * - Si la traza ya cae dentro de `world.bounds` y no tiene desplazamiento de circuito, mantiene 'native'.
 * - Si MyWhoosh desplazó o rotó las coordenadas dentro del mundo (p. ej. Culture Ride, Ardennes, Tokyo Drift, Cities Loop),
 *   aplica alineación rígida 2D punto-a-segmento contra la red real de carreteras (umbral RMS <= 32 m).
 * - Si el mundo es esquemático o la ruta es un sector nuevo fuera del GPX (y fuera de bounds), centra proporcionalmente.
 */
export function alignCoordsToMyWhooshWorld(
  world: MyWhooshWorldDefinition,
  coords: Array<[number, number]>
): AlignedMyWhooshTrace {
  if (coords.length === 0) {
    return { mode: 'native', alignedCoords: coords, rmsErrorM: null, rotationDeg: 0, isApproximate: false };
  }

  const first = coords[0];
  const last = coords[coords.length - 1];
  const mid = coords[Math.floor(coords.length / 2)];
  const cacheKey = `${world.id}:${coords.length}:${first[0].toFixed(5)},${first[1].toFixed(5)}:${mid[0].toFixed(5)},${last[1].toFixed(5)}`;
  const cached = ALIGNMENT_CACHE.get(cacheKey);
  if (cached) return cached;

  const insideBounds = coords.every((p) => pointInBounds(p[0], p[1], world.bounds, 0.008));
  const net = getCompiledNetwork(world.id);
  const sample = samplePointsEvenly(coords, 48);

  if (insideBounds) {
    if (net) {
      // Check unshifted error first so native tracks (e.g. Hudayriyat GPX, Arcade Bay NE loop, Switzerland, France) stay untouched
      const sampleLocal = sample.map(([la, lo]) => toLocalXY(la, lo, net.refLat, net.refLon));
      const nativeRms = Math.sqrt(evalRmsSq(sampleLocal, net.segs, 0, 0, Infinity));
      const nativeQuantiles = evalPointQuantilesM(sample, net, {
        rmsM: nativeRms,
        thetaRad: 0,
        dx: 0,
        dy: 0,
        cX: 0,
        cY: 0,
      });
      if (nativeRms <= 34 || nativeQuantiles.p70M <= 28 || world.id === 'hudayriyat') {
        const res: AlignedMyWhooshTrace = {
          mode: 'native',
          alignedCoords: coords,
          rmsErrorM:
            nativeRms <= 34
              ? Math.round(nativeRms)
              : nativeQuantiles.p70M <= 28
                ? Math.round(nativeQuantiles.medianM)
                : null,
          rotationDeg: 0,
          isApproximate: false,
        };
        ALIGNMENT_CACHE.set(cacheKey, res);
        return res;
      }

      // If an activity fell inside world.bounds by coincidence yet has shifted geometry (e.g. Free Ride offset), snap cleanly if RMS <= 25m
      const shiftSol = solveRigidForNetwork(net, sample, false);
      if (shiftSol && shiftSol.rmsM <= 25 && shiftSol.rmsM < nativeRms * 0.4) {
        const aligned = applyRigidSolution(coords, net, shiftSol);
        if (aligned.some((p) => pointInBounds(p[0], p[1], world.bounds, 0.02))) {
          const res: AlignedMyWhooshTrace = {
            mode: 'rigid-road-lock',
            alignedCoords: aligned,
            rmsErrorM: Number(shiftSol.rmsM.toFixed(1)),
            rotationDeg: Math.round((shiftSol.thetaRad * 180) / Math.PI),
            isApproximate: false,
          };
          ALIGNMENT_CACHE.set(cacheKey, res);
          return res;
        }
      }

      // Robust Free Ride pass even when points happen to fall inside world.bounds
      const robustInBounds = solveRigidForNetwork(net, sample, false, 95 * 95);
      if (robustInBounds) {
        const { medianM, p70M } = evalPointQuantilesM(sample, net, robustInBounds);
        if (medianM <= 16 && p70M <= 28 && medianM < nativeQuantiles.medianM * 0.4) {
          const aligned = applyRigidSolution(coords, net, robustInBounds);
          if (aligned.some((p) => pointInBounds(p[0], p[1], world.bounds, 0.02))) {
            const res: AlignedMyWhooshTrace = {
              mode: 'rigid-road-lock',
              alignedCoords: aligned,
              rmsErrorM: Number(medianM.toFixed(1)),
              rotationDeg: Math.round((robustInBounds.thetaRad * 180) / Math.PI),
              isApproximate: false,
            };
            ALIGNMENT_CACHE.set(cacheKey, res);
            return res;
          }
        }
      }
    }
    const res: AlignedMyWhooshTrace = {
      mode: 'native',
      alignedCoords: coords,
      rmsErrorM: null,
      rotationDeg: 0,
      isApproximate: false,
    };
    ALIGNMENT_CACHE.set(cacheKey, res);
    return res;
  }

  // Track is outside canonical world.bounds: try rigid 2D road-lock alignment if road network exists
  if (net) {
    let sol = solveRigidForNetwork(net, sample, false);
    if (!sol || sol.rmsM > 28) {
      const rotSol = solveRigidForNetwork(net, sample, true);
      if (rotSol && (!sol || rotSol.rmsM < sol.rmsM)) {
        sol = rotSol;
      }
    }

    if (sol && sol.rmsM <= 32) {
      const aligned = applyRigidSolution(coords, net, sol);
      // Verify the aligned track lies cleanly inside world.bounds
      if (aligned.some((p) => pointInBounds(p[0], p[1], world.bounds, 0.02))) {
        const res: AlignedMyWhooshTrace = {
          mode: 'rigid-road-lock',
          alignedCoords: aligned,
          rmsErrorM: Number(sol.rmsM.toFixed(1)),
          rotationDeg: Math.round((sol.thetaRad * 180) / Math.PI),
          isApproximate: false,
        };
        ALIGNMENT_CACHE.set(cacheKey, res);
        return res;
      }
    }

    // Robust pass for Free Rides (arbitrary turns where ~70%+ rides known roads and part rides an unmapped expansion)
    const robustSol = solveRigidForNetwork(net, sample, false, 95 * 95);
    if (robustSol) {
      const { medianM, p70M } = evalPointQuantilesM(sample, net, robustSol);
      if (medianM <= 16 && p70M <= 28) {
        const aligned = applyRigidSolution(coords, net, robustSol);
        if (aligned.some((p) => pointInBounds(p[0], p[1], world.bounds, 0.02))) {
          const res: AlignedMyWhooshTrace = {
            mode: 'rigid-road-lock',
            alignedCoords: aligned,
            rmsErrorM: Number(medianM.toFixed(1)),
            rotationDeg: Math.round((robustSol.thetaRad * 180) / Math.PI),
            isApproximate: false,
          };
          ALIGNMENT_CACHE.set(cacheKey, res);
          return res;
        }
      }
    }
  }

  // Fallback for schematic worlds or unmapped offset tracks: center cleanly inside world.bounds
  const res: AlignedMyWhooshTrace = {
    mode: 'centered',
    alignedCoords: centerCoordsInBounds(coords, world.bounds),
    rmsErrorM: null,
    rotationDeg: 0,
    isApproximate: true,
  };
  ALIGNMENT_CACHE.set(cacheKey, res);
  return res;
}

/**
 * Busca qué mundo de carreteras reales encaja mejor por forma geométrica (cuando falta el título).
 */
export function matchGpsToWorldRoads(
  coords: Array<[number, number]>,
  maxDistKm = 650
): { world: MyWhooshWorldDefinition; rmsM: number } | null {
  if (coords.length < 10) return null;
  const sample = samplePointsEvenly(coords, 44);
  const [cLat, cLon] = sample[Math.floor(sample.length / 2)];

  let best: { world: MyWhooshWorldDefinition; rmsM: number } | null = null;
  for (const world of MYWHOOSH_WORLDS) {
    if (!world.hasRealRoadNetwork) continue;
    const net = getCompiledNetwork(world.id);
    if (!net) continue;
    // Fast regional filter
    const dLatKm = (cLat - net.refLat) * 111.32;
    const dLonKm = (cLon - net.refLon) * 111.32 * Math.cos((net.refLat * Math.PI) / 180);
    if (Math.hypot(dLatKm, dLonKm) > maxDistKm) continue;

    const sol = solveRigidForNetwork(net, sample, false);
    if (sol && sol.rmsM <= 26 && (!best || sol.rmsM < best.rmsM)) {
      best = { world, rmsM: sol.rmsM };
      if (sol.rmsM < 10) break;
    }
  }
  return best;
}

/**
 * Resuelve el mundo de MyWhoosh para una actividad, devolviendo SIEMPRE los `bounds`
 * canónicos del SVG (para mantener 0px de distorsión entre carreteras y mapa base).
 */
export function resolveMyWhooshWorldForActivity(params: {
  worldName?: string | null;
  title?: string | null;
  sport?: string | null;
  subSport?: string | null;
  deviceName?: string | null;
  coords?: Array<[number, number]>;
}): { world: MyWhooshWorldDefinition; bounds: [[number, number], [number, number]] } | null {
  const { worldName, title, coords = [] } = params;

  // 1. Nombre explícito de mundo elegido o guardado en DB
  const byWorld = getMyWhooshWorldByIdOrName(worldName);
  if (byWorld) {
    return { world: byWorld, bounds: byWorld.bounds };
  }

  // 2. Título de ruta/mundo (solo si existe señal virtual o el título es inequívoco de MyWhoosh)
  const virtualSignal = isMyWhooshContext(params);
  if (virtualSignal) {
    const byTitle = getMyWhooshWorldByIdOrName(title);
    if (byTitle) {
      return { world: byTitle, bounds: byTitle.bounds };
    }
  }

  // 3. Coordenadas directas dentro del mundo (solo si hay señal virtual o el mundo es oceánico/desierto aislado)
  if (coords.length > 0) {
    const [lat, lon] = coords[0];
    for (const world of MYWHOOSH_WORLDS) {
      // Para mundos ubicados en ciudades/regiones muy transitadas en exterior, exigir señal virtual
      const populatedRegion = [
        'switzerland',
        'france',
        'belgium',
        'california',
        'japan',
        'colombia',
        'canada',
        'bled',
        'alula',
        'australia',
      ].includes(world.id);
      if (populatedRegion && !virtualSignal) continue;

      if (pointInBounds(lat, lon, world.bounds, 0.015)) {
        return { world, bounds: world.bounds };
      }
      if (world.altBounds) {
        for (const ab of world.altBounds) {
          if (pointInBounds(lat, lon, ab, 0.015)) {
            return { world, bounds: world.bounds };
          }
        }
      }
    }

    // 3. Si es inequívocamente una actividad virtual/MyWhoosh con GPS desplazado y título genérico ("Morning Ride"), intentar road-lock regional
    if (virtualSignal) {
      const roadMatch = matchGpsToWorldRoads(coords);
      if (roadMatch) {
        return { world: roadMatch.world, bounds: roadMatch.world.bounds };
      }
    }
  }

  return null;
}
