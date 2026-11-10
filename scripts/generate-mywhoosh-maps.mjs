import fs from 'node:fs';
import path from 'node:path';

const GPX_DIR = '/tmp/mw_maps';
const EXTRA_TRACKS_PATH = path.resolve('scripts/extra-world-tracks.json');
const OUT_SVG_DIR = path.resolve('public/maps/mywhoosh');
const OUT_DATA_PATH = path.resolve('src/lib/mywhoosh-roads-data.json');

function mercY(latDeg) {
  const rad = Math.max(-85, Math.min(85, latDeg)) * (Math.PI / 180);
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function simplifyDp(pts, tolM = 18) {
  if (pts.length <= 4) return pts;
  const lat0 = pts[0][0];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111320;
  function perpDist(p, a, b) {
    const px = (p[1] - a[1]) * kx;
    const py = (p[0] - a[0]) * ky;
    const bx = (b[1] - a[1]) * kx;
    const by = (b[0] - a[0]) * ky;
    const len2 = bx * bx + by * by;
    if (len2 === 0) return Math.hypot(px, py);
    const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
    return Math.hypot(px - t * bx, py - t * by);
  }
  function dp(arr) {
    let maxD = 0;
    let idx = 0;
    for (let i = 1; i < arr.length - 1; i++) {
      const d = perpDist(arr[i], arr[0], arr[arr.length - 1]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolM) {
      const left = dp(arr.slice(0, idx + 1));
      const right = dp(arr.slice(idx));
      return [...left.slice(0, -1), ...right];
    }
    return [arr[0], arr[arr.length - 1]];
  }
  return dp(pts);
}

function parseGpxFile(filePath) {
  const txt = fs.readFileSync(filePath, 'utf8');
  const tracks = [];
  for (const m of txt.matchAll(/<trk>([\s\S]*?)<\/trk>/g)) {
    const nameMatch = m[1].match(/<name>(.*?)<\/name>/);
    const pts = [];
    for (const p of m[1].matchAll(/lat="([-0-9.]+)"\s+lon="([-0-9.]+)"/g)) {
      pts.push([Number(p[1]), Number(p[2])]);
    }
    if (pts.length > 5) {
      tracks.push({ name: nameMatch?.[1] || '', pts });
    }
  }
  return tracks;
}

function escXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function computeMercatorDimensions(bounds) {
  const [[south, west], [north, east]] = bounds;
  const xSpanRad = (east - west) * (Math.PI / 180);
  const ySpanMerc = mercY(north) - mercY(south);
  const ratio = Math.max(0.55, Math.min(1.85, xSpanRad / (ySpanMerc || 1e-6)));
  const width = 1200;
  const height = Math.round(width / ratio);
  return { width, height };
}

function makeProjector(bounds, width, height) {
  const [[south, west], [north, east]] = bounds;
  const mNorth = mercY(north);
  const mSouth = mercY(south);
  const mSpan = mNorth - mSouth || 1e-6;
  const lonSpan = east - west || 1e-6;
  return (lat, lon) => {
    const x = ((lon - west) / lonSpan) * width;
    const y = ((mNorth - mercY(lat)) / mSpan) * height;
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  };
}

function buildWorldSvg({
  id,
  title,
  subtitle,
  bounds,
  tracks,
  dashedTracks = [],
  landmarks = [],
  palette,
  waterPolys = [],
  riverPaths = [],
  contourMode = 'hills',
  syntheticCircuits = [],
}) {
  const { width, height } = computeMercatorDimensions(bounds);
  const project = makeProjector(bounds, width, height);

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`  <defs>`);
  lines.push(`    <linearGradient id="bgGrad-${id}" x1="0%" y1="0%" x2="100%" y2="100%">`);
  lines.push(`      <stop offset="0%" stop-color="${palette.bg1}" />`);
  lines.push(`      <stop offset="55%" stop-color="${palette.bg2}" />`);
  lines.push(`      <stop offset="100%" stop-color="${palette.bg3}" />`);
  lines.push(`    </linearGradient>`);
  lines.push(`    <pattern id="grid-${id}" width="72" height="72" patternUnits="userSpaceOnUse">`);
  lines.push(`      <path d="M 72 0 L 0 0 0 72" fill="none" stroke="rgba(15,23,42,0.055)" stroke-width="1"/>`);
  lines.push(`    </pattern>`);
  lines.push(`  </defs>`);
  lines.push(`  <rect width="${width}" height="${height}" fill="url(#bgGrad-${id})" />`);
  lines.push(`  <rect width="${width}" height="${height}" fill="url(#grid-${id})" />`);

  // Subtle biome terrain shapes
  if (contourMode === 'dunes') {
    for (let i = 0; i < 6; i++) {
      const y = Math.round(height * (0.14 + i * 0.14));
      lines.push(
        `  <path d="M 0 ${y} Q ${Math.round(width * 0.28)} ${y - 45} ${Math.round(width * 0.55)} ${y + 18} T ${width} ${y - 24} L ${width} ${height} L 0 ${height} Z" fill="${palette.contour}" fill-opacity="${(0.11 + i * 0.03).toFixed(2)}" />`
      );
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const r1 = Math.round(Math.min(width, height) * (0.48 - i * 0.075));
      const cx = Math.round(width * (0.46 + (i % 2 === 0 ? 0.08 : -0.06)));
      const cy = Math.round(height * (0.44 + (i % 2 === 0 ? -0.05 : 0.06)));
      lines.push(
        `  <ellipse cx="${cx}" cy="${cy}" rx="${Math.round(r1 * 1.25)}" ry="${r1}" fill="${palette.contour}" fill-opacity="0.13" stroke="${palette.contourStroke}" stroke-opacity="0.18" stroke-width="1.4" />`
      );
    }
  }

  // Water bodies (polygon in lat/lon)
  for (const poly of waterPolys) {
    const pts = poly.map(([la, lo]) => project(la, lo).join(',')).join(' ');
    lines.push(
      `  <polygon points="${pts}" fill="${palette.water}" fill-opacity="0.72" stroke="${palette.waterStroke}" stroke-opacity="0.55" stroke-width="2" />`
    );
  }

  // Rivers / canals
  for (const r of riverPaths) {
    const d = r
      .map(([la, lo], idx) => {
        const [x, y] = project(la, lo);
        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
    lines.push(
      `  <path d="${d}" fill="none" stroke="${palette.water}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.78" />`
    );
    lines.push(
      `  <path d="${d}" fill="none" stroke="${palette.waterStroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="0.35" />`
    );
  }

  // Deduplicate exact road segments across tracks so multi-lap routes aren't drawn 5x while keeping 100% of unique roads
  const toUniqueSvgPaths = (trackList) => {
    const seenEdge = new Set();
    const segmentsOut = [];
    for (const latLonPts of trackList) {
      const simp = simplifyDp(latLonPts, 14);
      let currentRun = [];
      for (let i = 0; i < simp.length - 1; i++) {
        const a = simp[i];
        const b = simp[i + 1];
        const k1 = `${Math.round(a[0] * 4000)}:${Math.round(a[1] * 4000)}`;
        const k2 = `${Math.round(b[0] * 4000)}:${Math.round(b[1] * 4000)}`;
        const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        const midKey = `${Math.round(((a[0] + b[0]) / 2) * 3500)}:${Math.round(((a[1] + b[1]) / 2) * 3500)}`;
        if (!seenEdge.has(key) && !seenEdge.has(midKey)) {
          seenEdge.add(key);
          seenEdge.add(midKey);
          if (currentRun.length === 0) currentRun.push(a);
          currentRun.push(b);
        } else if (currentRun.length >= 2) {
          segmentsOut.push(currentRun);
          currentRun = [];
        } else {
          currentRun = [];
        }
      }
      if (currentRun.length >= 2) segmentsOut.push(currentRun);
    }
    return segmentsOut.map((run) =>
      run
        .map(([la, lo], idx) => {
          const [x, y] = project(la, lo);
          return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`;
        })
        .join(' ')
    );
  };

  const mainPaths = toUniqueSvgPaths(tracks);
  const dashedPaths = toUniqueSvgPaths(dashedTracks);
  const synPaths = syntheticCircuits.map((ring) =>
    ring
      .map(([nx, ny], idx) => `${idx === 0 ? 'M' : 'L'} ${(nx * width).toFixed(1)} ${(ny * height).toFixed(1)}`)
      .join(' ')
  );

  const allMain = [...mainPaths, ...synPaths];

  // Pass 1: Soft road shadow
  lines.push(`  <g stroke="rgba(15,23,42,0.22)" stroke-width="10.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);

  // Pass 2: Dark outer road casing
  lines.push(`  <g stroke="#334155" stroke-width="7.2" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);

  // Pass 3: Clean crisp bright inner road surface
  lines.push(`  <g stroke="#f8fafc" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);

  // Pass 4: Subtle center accent line
  lines.push(`  <g stroke="${palette.roadCenter}" stroke-opacity="0.45" stroke-width="1.2" stroke-dasharray="6 6" stroke-linecap="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);

  // Arcade / alternate gravel spurs
  if (dashedPaths.length > 0) {
    lines.push(`  <g stroke="#1e293b" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.78">`);
    for (const d of dashedPaths) lines.push(`    <path d="${d}" />`);
    lines.push(`  </g>`);
    lines.push(`  <g stroke="#67e8f9" stroke-width="3.2" stroke-dasharray="10 6" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.9">`);
    for (const d of dashedPaths) lines.push(`    <path d="${d}" />`);
    lines.push(`  </g>`);
  }

  // Landmarks with collision avoidance so labels never stack on top of each other
  const placedBoxes = [];
  const hudReserved = [
    { x0: 14, y0: height - 92, x1: 430, y1: height - 10 },
    { x0: width - 98, y0: height - 98, x1: width - 10, y1: height - 10 },
  ];

  for (const lm of landmarks) {
    const [cx, cy] =
      typeof lm.nx === 'number' && typeof lm.ny === 'number'
        ? [Number((lm.nx * width).toFixed(1)), Number((lm.ny * height).toFixed(1))]
        : project(lm.lat, lm.lon);

    if (cx < 20 || cx > width - 20 || cy < 20 || cy > height - 20) continue;

    const label = lm.eleM ? `${lm.name} · ${lm.eleM}m` : lm.name;
    const pillW = Math.max(72, label.length * 6.8 + 18);
    const pillH = 22;

    // Try 4 placements around marker to avoid collisions
    const candidates = [
      { bx: cx + 10, by: cy - 11 },
      { bx: cx - pillW - 10, by: cy - 11 },
      { bx: cx - pillW / 2, by: cy - 30 },
      { bx: cx - pillW / 2, by: cy + 12 },
    ];

    let chosen = null;
    for (const cand of candidates) {
      const x0 = Math.max(12, Math.min(width - pillW - 12, cand.bx));
      const y0 = Math.max(12, Math.min(height - pillH - 12, cand.by));
      const x1 = x0 + pillW;
      const y1 = y0 + pillH;
      const overlaps = [...placedBoxes, ...hudReserved].some(
        (b) => !(x1 + 6 < b.x0 || x0 - 6 > b.x1 || y1 + 6 < b.y0 || y0 - 6 > b.y1)
      );
      if (!overlaps) {
        chosen = { x0, y0, x1, y1 };
        break;
      }
    }

    const isClimb = lm.kind === 'climb' || Boolean(lm.eleM && lm.eleM >= 150);
    if (isClimb) {
      lines.push(
        `  <polygon points="${cx},${cy - 8} ${cx + 7},${cy + 5} ${cx - 7},${cy + 5}" fill="#f97316" stroke="#0f172a" stroke-width="2" />`
      );
    } else {
      lines.push(
        `  <circle cx="${cx}" cy="${cy}" r="5.5" fill="${palette.accent}" stroke="#0f172a" stroke-width="2" />`
      );
    }

    if (chosen) {
      placedBoxes.push(chosen);
      lines.push(
        `  <rect x="${chosen.x0.toFixed(1)}" y="${chosen.y0.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH}" rx="6" fill="rgba(15,23,42,0.82)" stroke="rgba(255,255,255,0.16)" stroke-width="1" />`
      );
      lines.push(
        `  <text x="${(chosen.x0 + 9).toFixed(1)}" y="${(chosen.y0 + 15).toFixed(1)}" font-family="system-ui,-apple-system,sans-serif" font-size="11.5" font-weight="700" fill="#f8fafc">${escXml(label)}</text>`
      );
    }
  }

  // Compass rose bottom-right (away from Leaflet top-left zoom and top-right layer selector)
  const crx = width - 48;
  const cry = height - 48;
  lines.push(`  <g transform="translate(${crx}, ${cry})" opacity="0.92">`);
  lines.push(`    <circle cx="0" cy="0" r="24" fill="rgba(15,23,42,0.82)" stroke="rgba(255,255,255,0.24)" stroke-width="1.5"/>`);
  lines.push(`    <polygon points="0,-16 4.5,0 0,-3 -4.5,0" fill="#f97316"/>`);
  lines.push(`    <polygon points="0,16 4.5,0 0,3 -4.5,0" fill="#cbd5e1"/>`);
  lines.push(`    <text x="0" y="2" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="#ffffff" stroke="rgba(15,23,42,0.9)" stroke-width="2.4" paint-order="stroke">N</text>`);
  lines.push(`  </g>`);

  // Title card bottom-left
  const badgeY = height - 76;
  const badgeW = Math.min(width - 120, Math.max(320, subtitle.length * 6.5 + 80));
  lines.push(`  <rect x="22" y="${badgeY}" width="${badgeW}" height="54" rx="12" fill="rgba(15,23,42,0.84)" stroke="rgba(255,255,255,0.18)" />`);
  lines.push(`  <circle cx="46" cy="${badgeY + 27}" r="8" fill="${palette.accent}" />`);
  lines.push(`  <text x="64" y="${badgeY + 24}" font-family="system-ui,-apple-system,sans-serif" font-size="16" font-weight="800" letter-spacing="1.1" fill="#ffffff">${escXml(title.toUpperCase())}</text>`);
  lines.push(`  <text x="64" y="${badgeY + 42}" font-family="system-ui,-apple-system,sans-serif" font-size="11.5" font-weight="500" fill="#cbd5e1">${escXml(subtitle)}</text>`);
  lines.push(`</svg>`);

  return { svg: lines.join('\n'), width, height };
}

function padBounds(pts, padFraction = 0.085, minSpanLat = 0.03) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const [la, lo] of pts) {
    if (la < minLat) minLat = la;
    if (la > maxLat) maxLat = la;
    if (lo < minLon) minLon = lo;
    if (lo > maxLon) maxLon = lo;
  }
  const latSpan = Math.max(minSpanLat, maxLat - minLat);
  const lonSpan = Math.max(minSpanLat, maxLon - minLon);
  const padLat = latSpan * padFraction;
  const padLon = lonSpan * padFraction;
  return [
    [Number((minLat - padLat).toFixed(5)), Number((minLon - padLon).toFixed(5))],
    [Number((maxLat + padLat).toFixed(5)), Number((maxLon + padLon).toFixed(5))],
  ];
}

// Dedup simplified road segments across multiple tracks of same world for compact alignment JSON
function buildCompactNetwork(tracks) {
  const seenEdge = new Set();
  const compacted = [];
  for (const tr of tracks) {
    const simp = simplifyDp(tr.pts, 55).map(([a, b]) => [
      Math.round(a * 1e4) / 1e4,
      Math.round(b * 1e4) / 1e4,
    ]);
    let currentRun = [];
    for (let i = 0; i < simp.length - 1; i++) {
      const a = simp[i];
      const b = simp[i + 1];
      const midKey = `${Math.round(((a[0] + b[0]) / 2) * 2500)}:${Math.round(((a[1] + b[1]) / 2) * 2500)}`;
      if (!seenEdge.has(midKey)) {
        seenEdge.add(midKey);
        if (currentRun.length === 0) currentRun.push(a);
        currentRun.push(b);
      } else if (currentRun.length >= 2) {
        compacted.push(currentRun);
        currentRun = [];
      } else {
        currentRun = [];
      }
    }
    if (currentRun.length >= 2) compacted.push(currentRun);
  }
  return compacted;
}

const extra = JSON.parse(fs.readFileSync(EXTRA_TRACKS_PATH, 'utf8'));
fs.mkdirSync(OUT_SVG_DIR, { recursive: true });

const PALETTES = {
  sand: { bg1: '#dfd0bc', bg2: '#d4be9f', bg3: '#c8ac8a', contour: '#a3805d', contourStroke: '#78593c', water: '#74a8c4', waterStroke: '#467d9c', roadCenter: '#f59e0b', accent: '#f97316' },
  desertGulf: { bg1: '#ded2bf', bg2: '#d5c4aa', bg3: '#cab494', contour: '#ac9370', contourStroke: '#806948', water: '#70abc5', waterStroke: '#3c7a96', roadCenter: '#f59e0b', accent: '#f59e0b' },
  island: { bg1: '#c6d6cd', bg2: '#bad0c6', bg3: '#aec6ba', contour: '#87a89a', contourStroke: '#5b7f72', water: '#7cb5cc', waterStroke: '#42829e', roadCenter: '#06b6d4', accent: '#06b6d4' },
  flanders: { bg1: '#c9d7bf', bg2: '#bdd0b2', bg3: '#afc4a3', contour: '#87a379', contourStroke: '#5b784e', water: '#76abca', waterStroke: '#467d9e', roadCenter: '#10b981', accent: '#10b981' },
  andes: { bg1: '#bfd1bf', bg2: '#b2c8b4', bg3: '#a3bca6', contour: '#759978', contourStroke: '#4b704e', water: '#73a6c2', waterStroke: '#407491', roadCenter: '#eab308', accent: '#eab308' },
  coastGreen: { bg1: '#c2d4ca', bg2: '#b5cbbd', bg3: '#a6c0b0', contour: '#7c9f8c', contourStroke: '#507562', water: '#75aec9', waterStroke: '#427d9b', roadCenter: '#22c55e', accent: '#22c55e' },
  california: { bg1: '#cad3c0', bg2: '#bec9b3', bg3: '#b1bea4', contour: '#8b9b7d', contourStroke: '#5f6f52', water: '#72a8c7', waterStroke: '#407798', roadCenter: '#ec4899', accent: '#ec4899' },
  japan: { bg1: '#cad2d5', bg2: '#bfc9cd', bg3: '#b2bec4', contour: '#84959c', contourStroke: '#586a73', water: '#78acc8', waterStroke: '#457b99', roadCenter: '#f43f5e', accent: '#f43f5e' },
  swiss: { bg1: '#c5d4d2', bg2: '#b8cac8', bg3: '#a9bfbd', contour: '#7d9b99', contourStroke: '#4f6e6c', water: '#6fa9c9', waterStroke: '#3b7799', roadCenter: '#ef4444', accent: '#ef4444' },
  france: { bg1: '#c7d6bf', bg2: '#bacbb2', bg3: '#acbfa3', contour: '#7f9e75', contourStroke: '#53734a', water: '#73a9c9', waterStroke: '#417899', roadCenter: '#3b82f6', accent: '#3b82f6' },
  alpine: { bg1: '#ccd1d9', bg2: '#bfc7d1', bg3: '#b0bac7', contour: '#7e8da1', contourStroke: '#516175', water: '#73a7c7', waterStroke: '#427799', roadCenter: '#a855f7', accent: '#a855f7' },
  futuristic: { bg1: '#bfced6', bg2: '#b1c4ce', bg3: '#a2b8c4', contour: '#718fa1', contourStroke: '#446375', water: '#69a7c7', waterStroke: '#347496', roadCenter: '#38bdf8', accent: '#38bdf8' },
};

const GPX_WORLD_CONFIGS = [
  {
    id: 'alula',
    gpx: 'Alula.gpx',
    title: 'AlUla',
    subtitle: 'Arabia Saudí · 16 rutas · Máx 679m D+ · GPS Red Real',
    palette: PALETTES.sand,
    contourMode: 'dunes',
    landmarks: [
      { name: 'Heritage Climb Summit', lat: 26.60838, lon: 37.76093, eleM: 333, kind: 'climb' },
      { name: 'Elephant Rock', lat: 26.59548, lon: 37.75664 },
      { name: 'Hegra', lat: 26.56892, lon: 37.74126 },
      { name: 'Nabatean Cave', lat: 26.63882, lon: 37.79069 },
      { name: 'Dome City', lat: 26.58216, lon: 37.73306 },
      { name: 'Canyon Oasis', lat: 26.61025, lon: 37.74357 },
      { name: 'Desert Trail', lat: 26.62476, lon: 37.7683, eleM: 215, kind: 'climb' },
    ],
  },
  {
    id: 'arabia',
    gpx: 'Arabia.gpx',
    title: 'Arabia',
    subtitle: 'EAU y Baréin · 30 rutas · Máx 925m D+ · GPS Red Real',
    palette: PALETTES.desertGulf,
    contourMode: 'dunes',
    waterPolys: [
      [[23.34, 52.16], [23.385, 52.16], [23.372, 52.208], [23.34, 52.212]],
    ],
    landmarks: [
      { name: 'Jabel Jais', lat: 23.49834, lon: 52.18677, eleM: 925, kind: 'climb' },
      { name: 'Jabel Hafeet', lat: 23.43505, lon: 52.26749, eleM: 735, kind: 'climb' },
      { name: 'Tel Moreeb', lat: 23.44638, lon: 52.23434, eleM: 310, kind: 'climb' },
      { name: 'Yas Marina', lat: 23.39534, lon: 52.18051 },
      { name: 'Al Wathba', lat: 23.44176, lon: 52.21279 },
      { name: 'Bahrain', lat: 23.35981, lon: 52.20331 },
      { name: 'Al Qudra Lake', lat: 23.37123, lon: 52.24974 },
    ],
  },
  {
    id: 'australia',
    gpx: 'Australia.gpx',
    title: 'Australia',
    subtitle: 'Queensland · 14 rutas · Máx 589m D+ · GPS Red Real',
    palette: PALETTES.coastGreen,
    waterPolys: [
      [[-21.033, 148.774], [-20.973, 148.774], [-20.973, 148.811], [-21.033, 148.811]],
    ],
    landmarks: [
      { name: 'Outerloop Summit', lat: -21.01266, lon: 148.76307, eleM: 404, kind: 'climb' },
      { name: 'Mount Pleasant', lat: -21.00833, lon: 148.75969, eleM: 164, kind: 'climb' },
      { name: 'Sydney Harbour Bridge', lat: -20.99875, lon: 148.73549 },
      { name: 'Wollongong', lat: -20.99804, lon: 148.77676 },
      { name: 'City Beach', lat: -20.98199, lon: 148.78173 },
      { name: 'Kangaroo Valley', lat: -21.02542, lon: 148.73169 },
    ],
  },
  {
    id: 'belgium',
    gpx: 'Belgium.gpx',
    title: 'Belgium',
    subtitle: 'Flandes y Ardenas · 10 rutas · Máx 492m D+ · GPS Red Real',
    palette: PALETTES.flanders,
    riverPaths: [
      [[50.752, 3.532], [50.778, 3.541], [50.808, 3.553], [50.838, 3.546], [50.865, 3.552]],
    ],
    landmarks: [
      { name: 'Muur van Geraardsbergen', lat: 50.82568, lon: 3.56314, eleM: 177, kind: 'climb' },
      { name: 'Koppenberg', lat: 50.78347, lon: 3.51818, eleM: 110, kind: 'climb' },
      { name: 'Oude Kwaremont', lat: 50.77239, lon: 3.57022, eleM: 94, kind: 'climb' },
      { name: 'Eikenberg', lat: 50.79666, lon: 3.50375, eleM: 62, kind: 'climb' },
      { name: 'Oudenaarde', lat: 50.80989, lon: 3.55206 },
      { name: 'Ghent', lat: 50.78439, lon: 3.52623 },
      { name: 'Bruges', lat: 50.76049, lon: 3.49418 },
      { name: 'Brussels', lat: 50.84208, lon: 3.54225 },
    ],
  },
  {
    id: 'california',
    gpx: 'California.gpx',
    title: 'California',
    subtitle: 'Golden Gate y Sierra · 13 rutas · Máx 815m D+ · GPS Red Real',
    palette: PALETTES.california,
    waterPolys: [
      [[38.378, -120.425], [38.404, -120.425], [38.404, -120.362], [38.378, -120.362]],
    ],
    landmarks: [
      { name: 'Hollywood Hills', lat: 38.44508, lon: -120.36226, eleM: 202, kind: 'climb' },
      { name: 'Mount Umunhum', lat: 38.39085, lon: -120.36856, eleM: 290, kind: 'climb' },
      { name: 'Golden Gate Bridge', lat: 38.39253, lon: -120.39084 },
      { name: 'Alcatraz', lat: 38.40231, lon: -120.3658 },
      { name: 'Onyx Peak', lat: 38.41393, lon: -120.33599, eleM: 210, kind: 'climb' },
      { name: 'Sequoia Forest', lat: 38.39892, lon: -120.40261 },
    ],
  },
  {
    id: 'colombia',
    gpx: 'Colombia.gpx',
    title: 'Colombia',
    subtitle: 'Cordillera Andina · 13 rutas · Máx 1667m D+ · GPS Red Real',
    palette: PALETTES.andes,
    riverPaths: [
      [[4.565, -72.815], [4.595, -72.805], [4.628, -72.792], [4.666, -72.775]],
    ],
    landmarks: [
      { name: 'Alto Limonar', lat: 4.606, lon: -72.86107, eleM: 1037, kind: 'climb' },
      { name: 'Cristo Rey', lat: 4.66058, lon: -72.83998, eleM: 1482, kind: 'climb' },
      { name: 'Paso De Alto', lat: 4.59916, lon: -72.78872, eleM: 889, kind: 'climb' },
      { name: 'Alto del Aguila', lat: 4.58206, lon: -72.80656, eleM: 349, kind: 'climb' },
      { name: 'Mompox City', lat: 4.60013, lon: -72.81722 },
      { name: 'Amazonia', lat: 4.62867, lon: -72.7696 },
    ],
  },
  {
    id: 'hudayriyat',
    gpx: 'Hudayriyat.gpx',
    title: 'Hudayriyat',
    subtitle: 'Abu Dabi · 8 rutas + Arcade Mode · GPS Red Real',
    palette: PALETTES.island,
    // Expanded bounds cleanly frame BOTH Hudayriyat Island (SW) AND Arcade Bay NE spur (Zombie Escape)
    fixedBounds: [
      [23.330, 54.952],
      [23.416, 55.056],
    ],
    waterPolys: [
      [[23.330, 54.952], [23.416, 54.952], [23.416, 54.960], [23.330, 54.960]],
      [[23.376, 54.980], [23.416, 54.980], [23.416, 55.056], [23.376, 55.056]],
    ],
    dashedTracks: extra['hudayriyat-arcade'].tracks,
    landmarks: [
      { name: 'Hudayriyat Summit', lat: 23.35686, lon: 54.97611, eleM: 134, kind: 'climb' },
      { name: 'Velodrome', lat: 23.36374, lon: 54.98306 },
      { name: 'Hudayriyat Bridge', lat: 23.37323, lon: 54.97396 },
      { name: 'Arcade Mode · Zombie Escape', lat: 23.404, lon: 55.036 },
    ],
  },
  {
    id: 'japan',
    gpx: 'Japan.gpx',
    title: 'Japan',
    subtitle: 'Monte Fuji y Kioto · 15 rutas · Máx 1584m D+ · GPS Red Real',
    palette: PALETTES.japan,
    waterPolys: [
      [[35.402, 135.166], [35.482, 135.166], [35.482, 135.188], [35.402, 135.188]],
    ],
    landmarks: [
      { name: 'Mount Fuji', lat: 35.40904, lon: 135.10357, eleM: 1016, kind: 'climb' },
      { name: 'Tokio Dome', lat: 35.46732, lon: 135.13979 },
      { name: 'Imperial Palace', lat: 35.45458, lon: 135.15384 },
      { name: 'Origami Village', lat: 35.46354, lon: 135.14272 },
      { name: 'Kyoto City', lat: 35.4374, lon: 135.16609 },
      { name: 'Tokyo Station', lat: 35.47446, lon: 135.12928 },
    ],
  },
  {
    id: 'mywhoosh-world',
    gpx: 'MywhooshWorld.gpx',
    title: 'MyWhoosh World',
    subtitle: 'Isla Central · 10 rutas · Máx 1014m D+ · GPS Red Real',
    palette: PALETTES.futuristic,
    waterPolys: [
      [[24.965, -71.038], [25.022, -71.038], [25.022, -71.018], [24.965, -71.018]],
      [[24.965, -70.982], [25.022, -70.982], [25.022, -70.970], [24.965, -70.970]],
    ],
    landmarks: [
      { name: 'Snowfall Mountain', lat: 24.9716, lon: -71.03076, eleM: 655, kind: 'climb' },
      { name: 'Blaze Summit', lat: 25.00776, lon: -70.98016, eleM: 235, kind: 'climb' },
      { name: 'Hyperion City', lat: 24.99521, lon: -71.00613 },
      { name: 'Enchanted Forest', lat: 25.01242, lon: -71.00324 },
      { name: 'Frostfire Station', lat: 24.98956, lon: -71.00976 },
    ],
  },
];

const EXTRA_WORLD_CONFIGS = [
  {
    id: 'switzerland',
    title: 'Switzerland',
    subtitle: 'Zúrich y Limmat · 10 rutas · Máx 932m D+ · GPS Calibrado',
    palette: PALETTES.swiss,
    bounds: [
      [47.314, 8.492],
      [47.405, 8.618],
    ],
    tracks: extra.switzerland.tracks,
    waterPolys: [
      [[47.314, 8.532], [47.368, 8.532], [47.362, 8.556], [47.314, 8.572]],
    ],
    riverPaths: [
      [[47.364, 8.544], [47.376, 8.541], [47.388, 8.531], [47.402, 8.515]],
    ],
    landmarks: [
      { name: 'Zürichbergstrasse', lat: 47.39444, lon: 8.52905, eleM: 466, kind: 'climb' },
      { name: 'Limmat Loop', lat: 47.345, lon: 8.548 },
      { name: 'Seeblick Spin', lat: 47.362, lon: 8.601 },
      { name: 'Lago de Zúrich', lat: 47.326, lon: 8.555 },
    ],
  },
  {
    id: 'france',
    title: 'France',
    subtitle: 'Morvan, París y Galibier · 10 rutas · Máx 1930m D+ · GPS Calibrado',
    palette: PALETTES.france,
    bounds: [
      [47.276, 3.862],
      [47.324, 3.926],
    ],
    tracks: extra.france.tracks,
    riverPaths: [
      [[47.278, 3.868], [47.295, 3.884], [47.308, 3.902], [47.321, 3.920]],
    ],
    landmarks: [
      { name: 'Mission Stage 2 / Morvan', lat: 47.301, lon: 3.895, eleM: 168, kind: 'climb' },
      { name: 'Circuito Clásico', lat: 47.291, lon: 3.882 },
    ],
  },
  {
    id: 'bhutan',
    title: 'Bhutan',
    subtitle: 'Himalaya, Timbu y Pele La · 8 rutas · Máx 1018m D+',
    palette: PALETTES.alpine,
    bounds: [
      [27.44, 89.6],
      [27.52, 89.7],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.24, 0.72], [0.36, 0.45], [0.56, 0.25], [0.78, 0.34], [0.72, 0.62], [0.48, 0.78], [0.24, 0.72]],
      [[0.36, 0.45], [0.52, 0.56], [0.72, 0.62]],
    ],
    landmarks: [
      { name: 'Dragon Rae Climb', nx: 0.56, ny: 0.25, eleM: 370, kind: 'climb' },
      { name: 'Pele La Pass', nx: 0.78, ny: 0.34, eleM: 300, kind: 'climb' },
      { name: 'Thimphu City', nx: 0.24, ny: 0.72 },
      { name: 'Paro Valley', nx: 0.48, ny: 0.78 },
    ],
  },
  {
    id: 'canada',
    title: 'Canada',
    subtitle: 'Montreal · Mount Royal · 3 rutas · Máx 984m D+',
    palette: PALETTES.france,
    bounds: [
      [45.492, -73.618],
      [45.524, -73.574],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.22, 0.68], [0.34, 0.35], [0.58, 0.24], [0.76, 0.44], [0.68, 0.74], [0.42, 0.78], [0.22, 0.68]],
    ],
    landmarks: [
      { name: 'Camillien Houde', nx: 0.58, ny: 0.24, eleM: 247, kind: 'climb' },
      { name: 'Avenue Pagnuelo', nx: 0.34, ny: 0.35, eleM: 60, kind: 'climb' },
      { name: 'Mont-Royal', nx: 0.68, ny: 0.74 },
    ],
  },
  {
    id: 'endurance-climb',
    title: 'Endurance Climb',
    subtitle: 'Ascenso Maratón 9 Secciones · 3 rutas · 2642m D+',
    palette: PALETTES.alpine,
    bounds: [
      [25.002, -71.042],
      [25.062, -70.962],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.16, 0.80], [0.28, 0.66], [0.22, 0.52], [0.44, 0.46], [0.38, 0.32], [0.64, 0.28], [0.80, 0.18]],
    ],
    landmarks: [
      { name: 'Cima Section 9/9', nx: 0.80, ny: 0.18, eleM: 2642, kind: 'climb' },
      { name: 'Campamento Medio', nx: 0.44, ny: 0.46, eleM: 1280, kind: 'climb' },
      { name: 'Base Endurance', nx: 0.16, ny: 0.80 },
    ],
  },
  {
    id: 'supertri',
    title: 'Supertri',
    subtitle: 'Circuito Urbano Mixto · 2 rutas · Ciclismo y Carrera',
    palette: PALETTES.island,
    bounds: [
      [24.398, 54.328],
      [24.432, 54.372],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.22, 0.62], [0.36, 0.30], [0.74, 0.30], [0.82, 0.60], [0.56, 0.76], [0.22, 0.62]],
    ],
    landmarks: [
      { name: 'Supertri E Lap', nx: 0.54, ny: 0.30, eleM: 20 },
      { name: 'Transición Arena', nx: 0.22, ny: 0.62 },
    ],
  },
  {
    id: 'uci-2024',
    title: 'UCI 2024',
    subtitle: 'Campeonato Mundial Esports UCI 2024 · 3 Etapas',
    palette: PALETTES.futuristic,
    bounds: [
      [24.44, 54.35],
      [24.49, 54.42],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.20, 0.66], [0.38, 0.28], [0.76, 0.34], [0.72, 0.72], [0.34, 0.76], [0.20, 0.66]],
    ],
    landmarks: [
      { name: 'Stage 2 Climb', nx: 0.38, ny: 0.28, eleM: 203, kind: 'climb' },
      { name: 'Stage 1 Sprint', nx: 0.72, ny: 0.72 },
    ],
  },
  {
    id: 'uci-2025',
    title: 'UCI 2025',
    subtitle: 'Campeonato Mundial Esports UCI 2025 · 3 Etapas',
    palette: PALETTES.futuristic,
    bounds: [
      [24.50, 54.40],
      [24.55, 54.47],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.20, 0.68], [0.36, 0.30], [0.78, 0.28], [0.74, 0.68], [0.46, 0.78], [0.20, 0.68]],
    ],
    landmarks: [
      { name: "The Mountain's Verdict", nx: 0.78, ny: 0.28, eleM: 751, kind: 'climb' },
      { name: "Sprinter's Paradise", nx: 0.20, ny: 0.68 },
    ],
  },
  {
    id: 'uci-2026',
    title: 'UCI 2026',
    subtitle: 'Pearl District & Horizon District · 3 Etapas',
    palette: PALETTES.futuristic,
    bounds: [
      [24.56, 54.45],
      [24.61, 54.52],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.18, 0.56], [0.34, 0.28], [0.54, 0.42], [0.74, 0.28], [0.84, 0.62], [0.58, 0.76], [0.18, 0.56]],
    ],
    landmarks: [
      { name: 'Pearl District (Stage 1)', nx: 0.34, ny: 0.28, eleM: 98, kind: 'climb' },
      { name: 'Horizon District (Stage 2)', nx: 0.74, ny: 0.28, eleM: 44 },
    ],
  },
  {
    id: 'bled',
    title: 'Bled',
    subtitle: 'Lago Bled · Eslovenia · Circuito Remo 10 km',
    palette: PALETTES.swiss,
    bounds: [
      [46.355, 14.075],
      [46.375, 14.115],
    ],
    tracks: [],
    waterPolys: [
      [[46.359, 14.082], [46.369, 14.082], [46.370, 14.106], [46.358, 14.106]],
    ],
    syntheticCircuits: [
      [[0.22, 0.54], [0.80, 0.50]],
    ],
    landmarks: [
      { name: 'Isla de Bled', nx: 0.48, ny: 0.52 },
    ],
  },
];

const roadsData = {
  worlds: {},
};

for (const cfg of GPX_WORLD_CONFIGS) {
  const gpxTracks = parseGpxFile(path.join(GPX_DIR, cfg.gpx));
  const allPts = gpxTracks.flatMap((t) => t.pts);
  const bounds = cfg.fixedBounds ?? padBounds(allPts, 0.085);
  const { svg, width, height } = buildWorldSvg({
    id: cfg.id,
    title: cfg.title,
    subtitle: cfg.subtitle,
    bounds,
    tracks: gpxTracks.map((t) => t.pts),
    dashedTracks: cfg.dashedTracks ?? [],
    landmarks: cfg.landmarks,
    palette: cfg.palette,
    waterPolys: cfg.waterPolys ?? [],
    riverPaths: cfg.riverPaths ?? [],
    contourMode: cfg.contourMode ?? 'hills',
  });
  fs.writeFileSync(path.join(OUT_SVG_DIR, `${cfg.id}.svg`), svg);

  const compactTracks = buildCompactNetwork(gpxTracks);
  const netPts = compactTracks.flat();
  const refLat = Number((netPts.reduce((s, p) => s + p[0], 0) / netPts.length).toFixed(5));
  const refLon = Number((netPts.reduce((s, p) => s + p[1], 0) / netPts.length).toFixed(5));
  roadsData.worlds[cfg.id] = {
    bounds,
    svgSize: [width, height],
    refLat,
    refLon,
    tracks: compactTracks,
  };
  console.log(`Generated ${cfg.id}.svg (${width}x${height}, ${(svg.length / 1024).toFixed(1)}KB, netTracks=${compactTracks.length})`);
}

for (const cfg of EXTRA_WORLD_CONFIGS) {
  const { svg, width, height } = buildWorldSvg({
    id: cfg.id,
    title: cfg.title,
    subtitle: cfg.subtitle,
    bounds: cfg.bounds,
    tracks: cfg.tracks,
    landmarks: cfg.landmarks,
    palette: cfg.palette,
    waterPolys: cfg.waterPolys ?? [],
    riverPaths: cfg.riverPaths ?? [],
    syntheticCircuits: cfg.syntheticCircuits ?? [],
  });
  fs.writeFileSync(path.join(OUT_SVG_DIR, `${cfg.id}.svg`), svg);

  const entry = {
    bounds: cfg.bounds,
    svgSize: [width, height],
  };
  if (cfg.tracks.length > 0) {
    const netPts = cfg.tracks.flat();
    entry.refLat = Number((netPts.reduce((s, p) => s + p[0], 0) / netPts.length).toFixed(5));
    entry.refLon = Number((netPts.reduce((s, p) => s + p[1], 0) / netPts.length).toFixed(5));
    entry.tracks = cfg.tracks;
  }
  roadsData.worlds[cfg.id] = entry;
  console.log(`Generated ${cfg.id}.svg (${width}x${height}, ${(svg.length / 1024).toFixed(1)}KB)`);
}

fs.writeFileSync(OUT_DATA_PATH, JSON.stringify(roadsData));
console.log(`Saved ${OUT_DATA_PATH}: ${(fs.statSync(OUT_DATA_PATH).size / 1024).toFixed(1)}KB`);
