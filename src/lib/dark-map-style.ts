import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

export const DARK_MAP_BACKGROUND = '#212121';
export const DARK_MAP_ATTRIBUTION = '© OpenFreeMap · OpenMapTiles · OpenStreetMap';

export type RgbTuple = [number, number, number];

export interface MapThemePalette {
  bg: RgbTuple;
  surface: RgbTuple;
  raised: RgbTuple;
  sunken: RgbTuple;
  line: RgbTuple;
  ink: RgbTuple;
  ink2: RgbTuple;
  primary: RgbTuple;
  accent: RgbTuple;
  accent2: RgbTuple;
}

export interface DarkMapThemeColors {
  background: string;
  residential: string;
  park: string;
  wood: string;
  institutional: string;
  water: string;
  aerowayArea: string;
  aerowayTaxiway: string;
  aerowayRunway: string;
  building: string;
  buildingOutline: string;
  pier: string;
  tunnelMinor: string;
  tunnelMajor: string;
  path: string;
  roadMinor: string;
  roadRamp: string;
  roadCasing: string;
  roadTertiary: string;
  roadMajorSubtle: string;
  roadMajor: string;
  roadMotorwaySubtle: string;
  roadMotorwayCasing: string;
  roadMotorway: string;
  railway: string;
  boundaryState: string;
  boundaryCountry: string;
  waterLabel: string;
  roadLabel: string;
  motorwayLabel: string;
  placeSubtle: string;
  placeTown: string;
  placeCity: string;
  halo: string;
  rasterTintFilter: string;
  controlBg: string;
  controlBorder: string;
  controlText: string;
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(rgb: RgbTuple): string {
  return (
    '#' +
    rgb
      .map((c) => clampByte(c).toString(16).padStart(2, '0'))
      .join('')
  );
}

function rgbToCss(rgb: RgbTuple, alpha?: number): string {
  const r = clampByte(rgb[0]);
  const g = clampByte(rgb[1]);
  const b = clampByte(rgb[2]);
  return alpha !== undefined ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgb(${r}, ${g}, ${b})`;
}

function mixRgb(a: RgbTuple, b: RgbTuple, weightB: number): RgbTuple {
  const t = Math.max(0, Math.min(1, weightB));
  const s = 1 - t;
  return [
    clampByte(a[0] * s + b[0] * t),
    clampByte(a[1] * s + b[1] * t),
    clampByte(a[2] * s + b[2] * t),
  ];
}

function liftRgb(rgb: RgbTuple, amount: number): RgbTuple {
  return mixRgb(rgb, [255, 255, 255], amount);
}

function darkenRgb(rgb: RgbTuple, amount: number): RgbTuple {
  return mixRgb(rgb, [0, 0, 0], amount);
}

function relativeLuminance([r, g, b]: RgbTuple): number {
  const lin = [r, g, b].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

export function parseCssRgbTuple(raw: string | null | undefined): RgbTuple | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const spaceNums = trimmed.match(/(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})/);
  if (spaceNums) {
    return [Number(spaceNums[1]), Number(spaceNums[2]), Number(spaceNums[3])];
  }
  const hex = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return [
      parseInt(hex[1].slice(0, 2), 16),
      parseInt(hex[1].slice(2, 4), 16),
      parseInt(hex[1].slice(4, 6), 16),
    ];
  }
  return null;
}

export function readMapThemePaletteFromDocument(): MapThemePalette | null {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const cs = getComputedStyle(document.documentElement);
  const bg = parseCssRgbTuple(cs.getPropertyValue('--bg'));
  const surface = parseCssRgbTuple(cs.getPropertyValue('--surface'));
  const raised = parseCssRgbTuple(cs.getPropertyValue('--raised'));
  const sunken = parseCssRgbTuple(cs.getPropertyValue('--sunken'));
  const line = parseCssRgbTuple(cs.getPropertyValue('--line'));
  const ink = parseCssRgbTuple(cs.getPropertyValue('--ink'));
  const ink2 = parseCssRgbTuple(cs.getPropertyValue('--ink-2'));
  const primary = parseCssRgbTuple(cs.getPropertyValue('--primary'));
  const accent = parseCssRgbTuple(cs.getPropertyValue('--accent'));
  const accent2 = parseCssRgbTuple(cs.getPropertyValue('--accent-2'));

  if (!bg || !surface || !primary || !accent) return null;
  return {
    bg,
    surface,
    raised: raised ?? surface,
    sunken: sunken ?? bg,
    line: line ?? surface,
    ink: ink ?? [238, 240, 244],
    ink2: ink2 ?? ink ?? [180, 186, 196],
    primary,
    accent,
    accent2: accent2 ?? accent,
  };
}

function toDarkSignature(rgb: RgbTuple, baseDark: RgbTuple, tintWeight: number): RgbTuple {
  const lum = relativeLuminance(rgb);
  const normalized = lum > 0.35 ? darkenRgb(rgb, 0.55) : rgb;
  return mixRgb(baseDark, normalized, tintWeight);
}

export function resolveDarkMapColors(palette: MapThemePalette | null): DarkMapThemeColors {
  if (!palette) {
    return {
      background: DARK_MAP_BACKGROUND,
      residential: '#242424',
      park: '#1a1c1b',
      wood: '#1c1e1d',
      institutional: '#252629',
      water: '#131518',
      aerowayArea: '#26282c',
      aerowayTaxiway: '#2f3136',
      aerowayRunway: '#383a40',
      building: '#27282b',
      buildingOutline: '#222326',
      pier: '#292a2e',
      tunnelMinor: '#2b2d31',
      tunnelMajor: '#36383e',
      path: '#2b2c31',
      roadMinor: '#33353a',
      roadRamp: '#42454c',
      roadCasing: '#242529',
      roadTertiary: '#41444a',
      roadMajorSubtle: '#3f4248',
      roadMajor: '#4d5058',
      roadMotorwaySubtle: '#494c54',
      roadMotorwayCasing: '#232428',
      roadMotorway: '#5c6069',
      railway: '#2c2e33',
      boundaryState: '#35373d',
      boundaryCountry: '#454850',
      waterLabel: '#676c73',
      roadLabel: '#8b9199',
      motorwayLabel: '#9da2a8',
      placeSubtle: '#9ca2aa',
      placeTown: '#b8bec6',
      placeCity: '#d1d5db',
      halo: '#18191c',
      rasterTintFilter: 'grayscale(100%) invert(94%) contrast(90%) brightness(88%)',
      controlBg: 'rgba(15, 23, 42, 0.88)',
      controlBorder: 'rgba(51, 65, 85, 0.7)',
      controlText: '#e2e8f0',
    };
  }

  const isDarkTheme = relativeLuminance(palette.bg) < 0.16;
  const accentSignature = mixRgb(palette.primary, palette.accent, 0.45);
  const secondarySignature = palette.accent2;

  const baseBg: RgbTuple = isDarkTheme
    ? mixRgb(palette.bg, palette.surface, 0.42)
    : mixRgb(toDarkSignature(palette.sunken, [17, 19, 23], 0.34), accentSignature, 0.09);

  const waterBase: RgbTuple = isDarkTheme
    ? mixRgb(darkenRgb(palette.sunken, 0.25), secondarySignature, 0.14)
    : mixRgb([12, 16, 22], secondarySignature, 0.16);

  const surfaceTone: RgbTuple = isDarkTheme
    ? mixRgb(palette.surface, palette.raised, 0.4)
    : liftRgb(baseBg, 0.06);

  const raisedTone: RgbTuple = isDarkTheme
    ? mixRgb(palette.raised, palette.line, 0.45)
    : mixRgb(liftRgb(baseBg, 0.11), accentSignature, 0.12);

  const lineTone: RgbTuple = isDarkTheme
    ? mixRgb(palette.line, accentSignature, 0.14)
    : mixRgb(liftRgb(baseBg, 0.16), accentSignature, 0.22);

  const parkTone = mixRgb(baseBg, secondarySignature, isDarkTheme ? 0.18 : 0.14);
  const woodTone = mixRgb(baseBg, secondarySignature, isDarkTheme ? 0.13 : 0.1);
  const roadMinorTone = mixRgb(raisedTone, accentSignature, 0.12);
  const roadTertiaryTone = liftRgb(mixRgb(lineTone, accentSignature, 0.2), 0.08);
  const roadMajorTone = liftRgb(mixRgb(lineTone, accentSignature, 0.26), 0.15);
  const roadMotorwayTone = liftRgb(mixRgb(lineTone, palette.primary, 0.3), 0.22);
  const labelLight = isDarkTheme ? palette.ink : liftRgb(mixRgb([220, 225, 235], accentSignature, 0.18), 0.2);
  const labelMid = isDarkTheme ? palette.ink2 : mixRgb(labelLight, baseBg, 0.34);

  const hueShiftFilter = `grayscale(82%) invert(93%) sepia(18%) contrast(92%) brightness(86%) drop-shadow(0 0 0 ${rgbToCss(accentSignature, 0.16)})`;

  return {
    background: rgbToHex(baseBg),
    residential: rgbToHex(surfaceTone),
    park: rgbToHex(parkTone),
    wood: rgbToHex(woodTone),
    institutional: rgbToHex(mixRgb(surfaceTone, raisedTone, 0.55)),
    water: rgbToHex(waterBase),
    aerowayArea: rgbToHex(surfaceTone),
    aerowayTaxiway: rgbToHex(raisedTone),
    aerowayRunway: rgbToHex(lineTone),
    building: rgbToHex(raisedTone),
    buildingOutline: rgbToHex(darkenRgb(raisedTone, 0.2)),
    pier: rgbToHex(raisedTone),
    tunnelMinor: rgbToHex(mixRgb(baseBg, roadMinorTone, 0.7)),
    tunnelMajor: rgbToHex(mixRgb(baseBg, roadTertiaryTone, 0.7)),
    path: rgbToHex(mixRgb(baseBg, lineTone, 0.55)),
    roadMinor: rgbToHex(roadMinorTone),
    roadRamp: rgbToHex(mixRgb(roadMinorTone, roadTertiaryTone, 0.65)),
    roadCasing: rgbToHex(darkenRgb(baseBg, 0.2)),
    roadTertiary: rgbToHex(roadTertiaryTone),
    roadMajorSubtle: rgbToHex(mixRgb(roadMinorTone, roadMajorTone, 0.5)),
    roadMajor: rgbToHex(roadMajorTone),
    roadMotorwaySubtle: rgbToHex(mixRgb(roadTertiaryTone, roadMotorwayTone, 0.5)),
    roadMotorwayCasing: rgbToHex(darkenRgb(baseBg, 0.28)),
    roadMotorway: rgbToHex(roadMotorwayTone),
    railway: rgbToHex(mixRgb(baseBg, lineTone, 0.5)),
    boundaryState: rgbToHex(mixRgb(lineTone, secondarySignature, 0.25)),
    boundaryCountry: rgbToHex(mixRgb(lineTone, accentSignature, 0.32)),
    waterLabel: rgbToHex(mixRgb(labelMid, secondarySignature, 0.35)),
    roadLabel: rgbToHex(mixRgb(labelMid, labelLight, 0.25)),
    motorwayLabel: rgbToHex(mixRgb(labelMid, accentSignature, 0.2)),
    placeSubtle: rgbToHex(mixRgb(labelMid, labelLight, 0.35)),
    placeTown: rgbToHex(mixRgb(labelMid, labelLight, 0.65)),
    placeCity: rgbToHex(labelLight),
    halo: rgbToHex(darkenRgb(baseBg, 0.22)),
    rasterTintFilter: hueShiftFilter,
    controlBg: rgbToCss(surfaceTone, 0.9),
    controlBorder: rgbToCss(lineTone, 0.85),
    controlText: rgbToHex(labelLight),
  };
}

export function buildThemedDarkMapStyle(palette: MapThemePalette | null): StyleSpecification {
  const c = resolveDarkMapColors(palette);

  const recoloredLayers = DARK_MAP_STYLE.layers.map((layer): LayerSpecification => {
    const next = {
      ...layer,
      paint: { ...(layer.paint as Record<string, unknown>) },
    } as Record<string, unknown>;
    const paint = next.paint as Record<string, unknown>;

    switch (layer.id) {
      case 'background':
        paint['background-color'] = c.background;
        break;
      case 'landuse_residential':
        paint['fill-color'] = c.residential;
        break;
      case 'park':
      case 'landuse_park':
        paint['fill-color'] = c.park;
        break;
      case 'landcover_wood':
        paint['fill-color'] = c.wood;
        break;
      case 'landuse_institutional':
        paint['fill-color'] = c.institutional;
        break;
      case 'water':
        paint['fill-color'] = c.water;
        break;
      case 'waterway':
        paint['line-color'] = c.water;
        break;
      case 'aeroway_area':
        paint['fill-color'] = c.aerowayArea;
        break;
      case 'aeroway_taxiway':
        paint['line-color'] = c.aerowayTaxiway;
        break;
      case 'aeroway_runway':
        paint['line-color'] = c.aerowayRunway;
        break;
      case 'building':
        paint['fill-color'] = c.building;
        paint['fill-outline-color'] = c.buildingOutline;
        break;
      case 'road_area_pier':
        paint['fill-color'] = c.pier;
        break;
      case 'tunnel_minor':
        paint['line-color'] = c.tunnelMinor;
        break;
      case 'tunnel_major':
        paint['line-color'] = c.tunnelMajor;
        break;
      case 'highway_path':
        paint['line-color'] = c.path;
        break;
      case 'highway_minor':
        paint['line-color'] = c.roadMinor;
        break;
      case 'highway_ramp':
        paint['line-color'] = c.roadRamp;
        break;
      case 'highway_tertiary_casing':
      case 'highway_major_casing':
        paint['line-color'] = c.roadCasing;
        break;
      case 'highway_tertiary_inner':
        paint['line-color'] = c.roadTertiary;
        break;
      case 'highway_major_subtle':
        paint['line-color'] = c.roadMajorSubtle;
        break;
      case 'highway_major_inner':
        paint['line-color'] = c.roadMajor;
        break;
      case 'highway_motorway_subtle':
        paint['line-color'] = c.roadMotorwaySubtle;
        break;
      case 'highway_motorway_casing':
        paint['line-color'] = c.roadMotorwayCasing;
        break;
      case 'highway_motorway_inner':
        paint['line-color'] = c.roadMotorway;
        break;
      case 'railway':
        paint['line-color'] = c.railway;
        break;
      case 'railway_dashline':
        paint['line-color'] = c.background;
        break;
      case 'boundary_state':
        paint['line-color'] = c.boundaryState;
        break;
      case 'boundary_country':
        paint['line-color'] = c.boundaryCountry;
        break;
      case 'water_name_line':
      case 'water_name_point':
        paint['text-color'] = c.waterLabel;
        paint['text-halo-color'] = c.water;
        break;
      case 'highway_name_minor':
        paint['text-color'] = c.roadLabel;
        paint['text-halo-color'] = c.halo;
        break;
      case 'highway_name_motorway':
        paint['text-color'] = c.motorwayLabel;
        paint['text-halo-color'] = c.halo;
        break;
      case 'place_other':
      case 'place_village':
      case 'place_state':
      case 'place_country':
        paint['text-color'] = c.placeSubtle;
        paint['text-halo-color'] = c.halo;
        break;
      case 'place_town':
        paint['text-color'] = c.placeTown;
        paint['text-halo-color'] = c.halo;
        break;
      case 'place_city':
        paint['text-color'] = c.placeCity;
        paint['text-halo-color'] = c.halo;
        break;
    }

    return next as unknown as LayerSpecification;
  });

  return {
    ...DARK_MAP_STYLE,
    name: 'Bilifit Theme-Tinted Dark',
    layers: recoloredLayers,
  };
}

/**
 * Estilo vectorial oscuro monocromo inspirado en Huawei Health / Google Maps Dark.
 * Usa tiles vectoriales gratuitos de OpenFreeMap (OpenMapTiles) sin requerir API key.
 */
export const DARK_MAP_STYLE: StyleSpecification = {
  version: 8,
  name: 'Bilifit Monochrome Dark',
  sources: {
    openmaptiles: {
      type: 'vector',
      url: 'https://tiles.openfreemap.org/planet',
    },
  },
  glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': DARK_MAP_BACKGROUND,
      },
    },
    {
      id: 'landuse_residential',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      maxzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['==', ['get', 'class'], 'residential'],
      ],
      paint: {
        'fill-color': '#242424',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'park',
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'fill-color': '#1a1c1b',
        'fill-opacity': 0.85,
      },
    },
    {
      id: 'landuse_park',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['match', ['get', 'class'], ['park', 'cemetery', 'recreation_ground', 'pitch', 'village_green', 'grass'], true, false],
      ],
      paint: {
        'fill-color': '#1a1c1b',
        'fill-opacity': 0.85,
      },
    },
    {
      id: 'landcover_wood',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landcover',
      minzoom: 9,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['match', ['get', 'class'], ['wood', 'forest', 'grass'], true, false],
      ],
      paint: {
        'fill-color': '#1c1e1d',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 9, 0.25, 13, 0.7],
      },
    },
    {
      id: 'landuse_institutional',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'landuse',
      minzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['match', ['get', 'class'], ['hospital', 'school', 'university', 'college', 'stadium', 'industrial', 'commercial'], true, false],
      ],
      paint: {
        'fill-color': '#252629',
        'fill-opacity': 0.45,
      },
    },
    {
      id: 'water',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'water',
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
      ],
      paint: {
        'fill-antialias': true,
        'fill-color': '#131518',
      },
    },
    {
      id: 'waterway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'waterway',
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
      ],
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint: {
        'line-color': '#131518',
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 9, 0.6, 13, 1.8, 18, 5],
      },
    },
    {
      id: 'aeroway_area',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['match', ['get', 'class'], ['runway', 'taxiway', 'apron'], true, false],
      ],
      paint: {
        'fill-color': '#26282c',
      },
    },
    {
      id: 'aeroway_taxiway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 11,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'class'], 'taxiway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2f3136',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 11, 1, 18, 12],
      },
    },
    {
      id: 'aeroway_runway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'aeroway',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'class'], 'runway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#383a40',
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 2, 17, 36],
      },
    },
    {
      id: 'building',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'building',
      minzoom: 14,
      filter: ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
      paint: {
        'fill-antialias': true,
        'fill-color': '#27282b',
        'fill-outline-color': '#222326',
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14, 0, 15.5, 0.55],
      },
    },
    {
      id: 'road_area_pier',
      type: 'fill',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      filter: [
        'all',
        ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false],
        ['==', ['get', 'class'], 'pier'],
      ],
      paint: {
        'fill-color': '#292a2e',
      },
    },
    {
      id: 'tunnel_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['minor', 'service', 'track', 'street', 'street_limited', 'tertiary'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2b2d31',
        'line-dasharray': [2, 2],
        'line-opacity': 0.7,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 12, 1, 16, 4],
      },
    },
    {
      id: 'tunnel_major',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 8,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['primary', 'secondary', 'trunk', 'motorway'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#36383e',
        'line-dasharray': [3, 2],
        'line-opacity': 0.7,
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 1.2, 14, 4, 18, 12],
      },
    },
    {
      id: 'highway_path',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['path', 'footway', 'pedestrian', 'cycleway', 'steps', 'bridleway'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#2b2c31',
        'line-dasharray': [2, 1.5],
        'line-opacity': 0.85,
        'line-width': ['interpolate', ['exponential', 1.25], ['zoom'], 12, 0.6, 15, 1.4, 19, 4],
      },
    },
    {
      id: 'highway_minor',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['minor', 'service', 'track', 'street', 'street_limited'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#33353a',
        'line-opacity': 0.95,
        'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, 0.4, 12, 1.0, 14, 1.9, 16, 4.4, 20, 16],
      },
    },
    {
      id: 'highway_ramp',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['==', ['get', 'ramp'], 1],
        ['match', ['get', 'class'], ['tertiary', 'secondary', 'primary', 'trunk', 'motorway'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#42454c',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 0.7, 13, 1.8, 16, 4.2, 20, 12],
      },
    },
    {
      id: 'highway_tertiary_casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['==', ['get', 'class'], 'tertiary'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#242529',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 1.4, 14, 4.2, 20, 18],
      },
    },
    {
      id: 'highway_tertiary_inner',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['==', ['get', 'class'], 'tertiary'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#41444a',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 10, 0.9, 14, 2.9, 20, 15],
      },
    },
    {
      id: 'highway_major_subtle',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 6,
      maxzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['match', ['get', 'class'], ['primary', 'secondary', 'trunk'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#3f4248',
        'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.4, 9.9, 1.5],
      },
    },
    {
      id: 'highway_major_casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['match', ['get', 'class'], ['primary', 'secondary', 'trunk'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#242529',
        'line-width': ['interpolate', ['exponential', 1.35], ['zoom'], 10, 2.2, 14, 5.8, 20, 24],
      },
    },
    {
      id: 'highway_major_inner',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['match', ['get', 'class'], ['primary', 'secondary', 'trunk'], true, false],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#4d5058',
        'line-width': ['interpolate', ['exponential', 1.35], ['zoom'], 10, 1.4, 14, 4.2, 20, 20],
      },
    },
    {
      id: 'highway_motorway_subtle',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 4,
      maxzoom: 8,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'class'], 'motorway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#494c54',
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 8, 1.8],
      },
    },
    {
      id: 'highway_motorway_casing',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 8,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['==', ['get', 'class'], 'motorway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#232428',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 2.4, 12, 5.2, 15, 9.2, 20, 30],
      },
    },
    {
      id: 'highway_motorway_inner',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 8,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['!=', ['get', 'ramp'], 1],
        ['==', ['get', 'class'], 'motorway'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#5c6069',
        'line-width': ['interpolate', ['exponential', 1.4], ['zoom'], 8, 1.5, 12, 3.6, 15, 7.0, 20, 25],
      },
    },
    {
      id: 'railway',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['rail', 'transit'], true, false],
      ],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#2c2e33',
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 12, 1.0, 16, 2.0, 20, 4.5],
      },
    },
    {
      id: 'railway_dashline',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'transportation',
      minzoom: 12,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'brunnel'], 'tunnel'],
        ['match', ['get', 'class'], ['rail', 'transit'], true, false],
      ],
      layout: { 'line-join': 'round' },
      paint: {
        'line-color': '#202124',
        'line-dasharray': [3, 3],
        'line-width': ['interpolate', ['exponential', 1.3], ['zoom'], 12, 0.6, 16, 1.2, 20, 3.0],
      },
    },
    {
      id: 'boundary_state',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      minzoom: 5,
      filter: ['==', ['get', 'admin_level'], 4],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#35373d',
        'line-dasharray': [3, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.7, 12, 1.5],
      },
    },
    {
      id: 'boundary_country',
      type: 'line',
      source: 'openmaptiles',
      'source-layer': 'boundary',
      filter: ['==', ['get', 'admin_level'], 2],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#454850',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 10, 2.2],
      },
    },
    {
      id: 'water_name_line',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 11,
      filter: ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 350,
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Italic'],
        'text-rotation-alignment': 'map',
        'text-size': 11,
      },
      paint: {
        'text-color': '#676c73',
        'text-halo-color': '#131518',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'water_name_point',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'water_name',
      minzoom: 6,
      filter: ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Italic'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 10, 12, 13],
      },
      paint: {
        'text-color': '#676c73',
        'text-halo-color': '#131518',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'highway_name_minor',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 13.5,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['!=', ['get', 'class'], 'motorway'],
      ],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 320,
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Regular'],
        'text-max-angle': 30,
        'text-rotation-alignment': 'map',
        'text-size': ['interpolate', ['linear'], ['zoom'], 13.5, 10, 16, 12],
      },
      paint: {
        'text-color': '#8b9199',
        'text-halo-blur': 0.4,
        'text-halo-color': '#1d1e21',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'highway_name_motorway',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'transportation_name',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['LineString', 'MultiLineString'], true, false],
        ['==', ['get', 'class'], 'motorway'],
        ['has', 'ref'],
      ],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 350,
        'text-field': ['to-string', ['get', 'ref']],
        'text-font': ['Noto Sans Bold'],
        'text-rotation-alignment': 'viewport',
        'text-size': 10,
      },
      paint: {
        'text-color': '#9da2a8',
        'text-halo-color': '#1f2024',
        'text-halo-width': 1.6,
      },
    },
    {
      id: 'place_other',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 11,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['match', ['get', 'class'], ['hamlet', 'isolated_dwelling', 'neighbourhood', 'suburb', 'quarter'], true, false],
      ],
      layout: {
        'text-anchor': 'center',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Bold'],
        'text-justify': 'center',
        'text-letter-spacing': 0.08,
        'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 9.5, 14, 11.5],
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': '#9ca2aa',
        'text-halo-blur': 0.5,
        'text-halo-color': '#1b1c1e',
        'text-halo-width': 1.6,
      },
    },
    {
      id: 'place_village',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['==', ['get', 'class'], 'village'],
      ],
      layout: {
        'text-anchor': 'center',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Regular'],
        'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 12.5],
      },
      paint: {
        'text-color': '#a6acb4',
        'text-halo-blur': 0.5,
        'text-halo-color': '#1b1c1e',
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'place_town',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 8,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['==', ['get', 'class'], 'town'],
      ],
      layout: {
        'text-anchor': 'center',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Bold'],
        'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10.5, 14, 14],
      },
      paint: {
        'text-color': '#b8bec6',
        'text-halo-blur': 0.5,
        'text-halo-color': '#191a1c',
        'text-halo-width': 1.6,
      },
    },
    {
      id: 'place_city',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 4,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['==', ['get', 'class'], 'city'],
      ],
      layout: {
        'text-anchor': 'center',
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Bold'],
        'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10.5, 10, 15, 14, 18],
      },
      paint: {
        'text-color': '#d1d5db',
        'text-halo-blur': 0.5,
        'text-halo-color': '#17181a',
        'text-halo-width': 1.8,
      },
    },
    {
      id: 'place_state',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      minzoom: 4,
      maxzoom: 10,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['==', ['get', 'class'], 'state'],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Regular'],
        'text-letter-spacing': 0.12,
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 9.5, 8, 12],
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': '#7e838a',
        'text-halo-color': '#18191c',
        'text-halo-width': 1.4,
      },
    },
    {
      id: 'place_country',
      type: 'symbol',
      source: 'openmaptiles',
      'source-layer': 'place',
      maxzoom: 7,
      filter: [
        'all',
        ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false],
        ['==', ['get', 'class'], 'country'],
      ],
      layout: {
        'text-field': ['coalesce', ['get', 'name'], ['get', 'name:latin'], ['get', 'name_en']],
        'text-font': ['Noto Sans Bold'],
        'text-letter-spacing': 0.1,
        'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 5, 13],
        'text-transform': 'uppercase',
      },
      paint: {
        'text-color': '#9da2a8',
        'text-halo-color': '#18191c',
        'text-halo-width': 1.6,
      },
    },
  ],
};
