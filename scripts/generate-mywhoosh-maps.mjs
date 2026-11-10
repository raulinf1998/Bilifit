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

function invMercY(my) {
  return (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI);
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
    for (const ptMatch of m[1].matchAll(/<trkpt\s+lat="([-0-9.]+)"\s+lon="([-0-9.]+)"(?:\s*\/>|>([\s\S]*?)<\/trkpt>)/g)) {
      const eleMatch = ptMatch[3]?.match(/<ele>([-0-9.]+)<\/ele>/);
      const lat = Number(ptMatch[1]);
      const lon = Number(ptMatch[2]);
      const ele = eleMatch ? Number(eleMatch[1]) : null;
      pts.push(ele !== null && Number.isFinite(ele) ? [lat, lon, ele] : [lat, lon]);
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

// Deterministic pseudo-noise for organic terrain, coastlines, dunes, forests
function hash2(ix, iy, seed = 1) {
  const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x, y, seed = 1) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, seed = 1, octaves = 3) {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * valueNoise2D(x * freq, y * freq, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return val / norm;
}

function distToSegSq(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const len2 = vx * vx + vy * vy;
  if (len2 === 0) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2));
  const cx = ax + t * vx;
  const cy = ay + t * vy;
  return (px - cx) ** 2 + (py - cy) ** 2;
}

function minDistToSegments(px, py, segs) {
  let best2 = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const d2 = distToSegSq(px, py, s[0], s[1], s[2], s[3]);
    if (d2 < best2) best2 = d2;
  }
  return Math.sqrt(best2);
}

function pointInPolyXY(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Marching Squares: extracts smooth chained contour polylines at threshold `level` from a scalar grid[row][col]
function marchingSquaresPolylines(grid, nx, ny, level, cellW, cellH, closeLoops = false) {
  const segs = [];
  const interp = (v1, v2) => {
    const dv = v2 - v1;
    if (Math.abs(dv) < 1e-7) return 0.5;
    return Math.max(0.02, Math.min(0.98, (level - v1) / dv));
  };

  for (let r = 0; r < ny - 1; r++) {
    for (let c = 0; c < nx - 1; c++) {
      const v0 = grid[r][c];
      const v1 = grid[r][c + 1];
      const v2 = grid[r + 1][c + 1];
      const v3 = grid[r + 1][c];
      const idx =
        (v0 >= level ? 8 : 0) |
        (v1 >= level ? 4 : 0) |
        (v2 >= level ? 2 : 0) |
        (v3 >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;

      const x0 = c * cellW;
      const y0 = r * cellH;
      const top = [x0 + interp(v0, v1) * cellW, y0];
      const right = [x0 + cellW, y0 + interp(v1, v2) * cellH];
      const bottom = [x0 + interp(v3, v2) * cellW, y0 + cellH];
      const left = [x0, y0 + interp(v0, v3) * cellH];

      const pushSeg = (a, b) => segs.push([a, b]);
      switch (idx) {
        case 1: pushSeg(left, bottom); break;
        case 2: pushSeg(bottom, right); break;
        case 3: pushSeg(left, right); break;
        case 4: pushSeg(top, right); break;
        case 5: {
          const avg = (v0 + v1 + v2 + v3) * 0.25;
          if (avg >= level) { pushSeg(left, top); pushSeg(bottom, right); }
          else { pushSeg(left, bottom); pushSeg(top, right); }
          break;
        }
        case 6: pushSeg(top, bottom); break;
        case 7: pushSeg(left, top); break;
        case 8: pushSeg(left, top); break;
        case 9: pushSeg(top, bottom); break;
        case 10: {
          const avg = (v0 + v1 + v2 + v3) * 0.25;
          if (avg >= level) { pushSeg(top, right); pushSeg(left, bottom); }
          else { pushSeg(left, top); pushSeg(bottom, right); }
          break;
        }
        case 11: pushSeg(top, right); break;
        case 12: pushSeg(left, right); break;
        case 13: pushSeg(bottom, right); break;
        case 14: pushSeg(left, bottom); break;
      }
    }
  }

  // Chain segments cleanly into continuous polylines
  const keyOf = (pt) => `${Math.round(pt[0] * 4)}_${Math.round(pt[1] * 4)}`;
  const adj = new Map();
  const used = new Uint8Array(segs.length);
  for (let i = 0; i < segs.length; i++) {
    const ka = keyOf(segs[i][0]);
    const kb = keyOf(segs[i][1]);
    if (!adj.has(ka)) adj.set(ka, []);
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(ka).push({ i, end: 0 });
    adj.get(kb).push({ i, end: 1 });
  }

  const chains = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const chain = [segs[i][0], segs[i][1]];

    // Extend forward
    while (true) {
      const tailK = keyOf(chain[chain.length - 1]);
      const links = adj.get(tailK) || [];
      const next = links.find((l) => !used[l.i]);
      if (!next) break;
      used[next.i] = 1;
      chain.push(next.end === 0 ? segs[next.i][1] : segs[next.i][0]);
    }
    // Extend backward
    while (true) {
      const headK = keyOf(chain[0]);
      const links = adj.get(headK) || [];
      const prev = links.find((l) => !used[l.i]);
      if (!prev) break;
      used[prev.i] = 1;
      chain.unshift(prev.end === 0 ? segs[prev.i][1] : segs[prev.i][0]);
    }

    if (chain.length >= 2) {
      if (closeLoops && Math.hypot(chain[0][0] - chain[chain.length - 1][0], chain[0][1] - chain[chain.length - 1][1]) < cellW * 1.4) {
        chain.push(chain[0]);
      }
      // Subsample slightly so paths stay ultra smooth & compact
      const smoothed = [chain[0]];
      for (let k = 1; k < chain.length - 1; k++) {
        const prev = smoothed[smoothed.length - 1];
        if (Math.hypot(chain[k][0] - prev[0], chain[k][1] - prev[1]) >= 8) {
          smoothed.push(chain[k]);
        }
      }
      smoothed.push(chain[chain.length - 1]);
      if (smoothed.length >= 2) chains.push(smoothed);
    }
  }
  return chains;
}

function closedIsoBands(grid, cols, rows, level, width, height) {
  const pCols = cols + 2;
  const pRows = rows + 2;
  const pad = Array.from({ length: pRows }, () => new Float32Array(pCols));
  for (let r = 0; r < pRows; r++) {
    for (let c = 0; c < pCols; c++) {
      if (r === 0 || r === pRows - 1 || c === 0 || c === pCols - 1) {
        pad[r][c] = -1e9;
      } else {
        pad[r][c] = grid[r - 1][c - 1];
      }
    }
  }
  const cellW = width / (cols - 1);
  const cellH = height / (rows - 1);
  // In padded grid, cell (r, c) starts at ((c - 1) * cellW, (r - 1) * cellH)
  const raw = marchingSquaresPolylines(pad, pCols, pRows, level, cellW, cellH, true);
  return raw.map((loop) =>
    loop.map(([x, y]) => [
      Math.max(0, Math.min(width, x - cellW)),
      Math.max(0, Math.min(height, y - cellH)),
    ])
  );
}

function chaikinPath(pts, closed = false) {
  let clean = pts;
  if (closed && clean.length > 2) {
    const first = clean[0];
    const last = clean[clean.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.5) {
      clean = clean.slice(0, -1);
    }
  }
  if (clean.length < 3) {
    return clean.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + (closed ? ' Z' : '');
  }
  let res = clean;
  const next = [];
  if (closed) {
    for (let i = 0; i < res.length; i++) {
      const a = res[i];
      const b = res[(i + 1) % res.length];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    res = next;
  } else {
    next.push(res[0]);
    for (let i = 0; i < res.length - 1; i++) {
      const a = res[i];
      const b = res[i + 1];
      next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    next.push(res[res.length - 1]);
    res = next;
  }
  return res.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ') + (closed ? ' Z' : '');
}

// Build interpolated elevation grid (with IDW from GPX points + landmark peaks + biome ridges)
function buildTerrainFields({
  width,
  height,
  project,
  tracks,
  dashedTracks,
  syntheticCircuits,
  landmarks,
  coastProfile,
  elevationRange,
  seed,
}) {
  const cols = 64;
  const rows = Math.max(44, Math.min(88, Math.round((cols * height) / width)));
  const cellW = width / (cols - 1);
  const cellH = height / (rows - 1);

  // Project road segments into SVG space
  const roadSegs = [];
  const mainLoops = [];
  const allTrackSets = [...tracks, ...dashedTracks];
  for (const tr of allTrackSets) {
    const simp = simplifyDp(tr, 24);
    const loopPts = simp.map(([la, lo]) => project(la, lo));
    if (loopPts.length >= 6) mainLoops.push(loopPts);
    for (let i = 0; i < loopPts.length - 1; i++) {
      roadSegs.push([loopPts[i][0], loopPts[i][1], loopPts[i + 1][0], loopPts[i + 1][1]]);
    }
  }
  for (const ring of syntheticCircuits) {
    const pts = ring.map(([nx, ny]) => [nx * width, ny * height]);
    if (pts.length >= 4) mainLoops.push(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      roadSegs.push([pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]]);
    }
  }

  // Gather elevation samples [x, y, eleM]
  const eleSamples = [];
  for (const tr of tracks) {
    const step = Math.max(1, Math.floor(tr.length / 180));
    for (let i = 0; i < tr.length; i += step) {
      const pt = tr[i];
      if (pt.length >= 3 && typeof pt[2] === 'number' && Number.isFinite(pt[2])) {
        const [x, y] = project(pt[0], pt[1]);
        eleSamples.push([x, y, pt[2]]);
      }
    }
  }
  for (const lm of landmarks) {
    if (typeof lm.eleM === 'number') {
      const [x, y] =
        typeof lm.nx === 'number' && typeof lm.ny === 'number'
          ? [lm.nx * width, lm.ny * height]
          : project(lm.lat, lm.lon);
      eleSamples.push([x, y, lm.eleM * 1.05]);
    }
  }

  const maxEle =
    eleSamples.length > 0
      ? Math.max(elevationRange?.[1] ?? 120, ...eleSamples.map((s) => s[2]))
      : elevationRange?.[1] ?? 300;
  const minEle =
    eleSamples.length > 0
      ? Math.min(0, ...eleSamples.map((s) => s[2]))
      : elevationRange?.[0] ?? 0;

  const eleGrid = Array.from({ length: rows }, () => new Float32Array(cols));
  const landGrid = Array.from({ length: rows }, () => new Float32Array(cols));

  const diag = Math.hypot(width, height);
  const idwRadius2 = (diag * 0.14) ** 2;

  for (let r = 0; r < rows; r++) {
    const py = r * cellH;
    const ny = py / height;
    for (let c = 0; c < cols; c++) {
      const px = c * cellW;
      const nx = px / width;

      // Base elevation from IDW + natural biome fbm mountains/valleys
      let eleVal = minEle + (maxEle - minEle) * 0.18;
      if (eleSamples.length > 0) {
        let wSum = 0;
        let vSum = 0;
        let maxWeight = 0;
        for (let k = 0; k < eleSamples.length; k++) {
          const sx = eleSamples[k][0];
          const sy = eleSamples[k][1];
          const d2 = (px - sx) ** 2 + (py - sy) ** 2 + 180;
          const w = 1 / (d2 * Math.sqrt(d2));
          if (w > maxWeight) maxWeight = w;
          wSum += w;
          vSum += w * eleSamples[k][2];
        }
        const idw = vSum / (wSum || 1);
        const roadDist = roadSegs.length > 0 ? minDistToSegments(px, py, roadSegs) : 0;
        const farBlend = Math.max(0, Math.min(1, (roadDist - width * 0.04) / (width * 0.25)));
        const nVal = fbm(nx * 5.2 + 1.3, ny * 5.2 + 2.7, seed, 3);
        const bgMountain = minEle + Math.pow(nVal, 1.35) * (maxEle - minEle) * 0.85;
        eleVal = idw * (1 - farBlend * 0.48) + bgMountain * (farBlend * 0.48) + (nVal - 0.5) * (maxEle - minEle) * 0.16;
      } else {
        const nVal = fbm(nx * 4.8, ny * 4.8, seed, 3);
        eleVal = minEle + Math.pow(nVal, 1.3) * (maxEle - minEle);
      }
      eleGrid[r][c] = eleVal;

      // Signed-distance land mask for coastal/island worlds
      let landScore = 1.0; // positive = land, negative = water
      if (coastProfile) {
        const dRoad = roadSegs.length > 0 ? minDistToSegments(px, py, roadSegs) : diag;
        const nCoast = (fbm(nx * 7.5, ny * 7.5, seed + 41, 3) - 0.5) * coastProfile.jitterPx;
        if (coastProfile.type === 'island') {
          const insideHull = coastProfile.fillLoops && mainLoops.some((lp) => pointInPolyXY(px, py, lp));
          const buf = coastProfile.bufferPx + nCoast;
          landScore = insideHull ? Math.max(buf * 0.5, buf - dRoad) : buf - dRoad;
          if (coastProfile.cutout) {
            const cut = coastProfile.cutout(nx, ny, dRoad);
            landScore = Math.min(landScore, cut);
          }
        } else if (coastProfile.type === 'eastSea') {
          const shoreX = coastProfile.shoreX(ny, width) + nCoast;
          const roadKeep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
          landScore = Math.max(shoreX - px, roadKeep);
        } else if (coastProfile.type === 'westBay') {
          const shoreX = coastProfile.shoreX(ny, width) + nCoast;
          const roadKeep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
          landScore = Math.max(px - shoreX, roadKeep);
        } else if (coastProfile.type === 'southLake') {
          const shoreY = coastProfile.shoreY(nx, height) + nCoast;
          const roadKeep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
          landScore = Math.max(shoreY - py, roadKeep);
        } else if (coastProfile.type === 'lakeCenter') {
          const dx = (nx - coastProfile.cx) / coastProfile.rx;
          const dy = (ny - coastProfile.cy) / coastProfile.ry;
          const lakeD = (Math.hypot(dx, dy) - 1) * width * 0.25 + nCoast;
          const islandD = coastProfile.islandR ? coastProfile.islandR - Math.hypot(nx - coastProfile.ix, ny - coastProfile.iy) * width : -999;
          landScore = Math.max(lakeD, islandD);
        }
      }
      landGrid[r][c] = landScore;
    }
  }

  return { cols, rows, cellW, cellH, eleGrid, landGrid, minEle, maxEle, roadSegs, mainLoops };
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
  coastProfile = null,
  riverPaths = [],
  customWaterPolys = [],
  forestZones = [],
  urbanZones = [],
  duneZones = [],
  canyonZones = [],
  specialFeatures = [],
  elevationRange = [0, 400],
  biome = 'temperate',
  syntheticCircuits = [],
  seed = 7,
}) {
  const { width, height } = computeMercatorDimensions(bounds);
  const project = makeProjector(bounds, width, height);

  const fields = buildTerrainFields({
    width,
    height,
    project,
    tracks,
    dashedTracks,
    syntheticCircuits,
    landmarks,
    coastProfile,
    elevationRange,
    seed,
  });

  const { cols, rows, cellW, cellH, eleGrid, landGrid, minEle, maxEle, roadSegs } = fields;
  const eleSpan = Math.max(20, maxEle - minEle);

  const lines = [];
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">`);
  lines.push(`  <defs>`);
  lines.push(`    <linearGradient id="bg-${id}" x1="0%" y1="0%" x2="100%" y2="100%">`);
  lines.push(`      <stop offset="0%" stop-color="${palette.land0}" />`);
  lines.push(`      <stop offset="55%" stop-color="${palette.land1}" />`);
  lines.push(`      <stop offset="100%" stop-color="${palette.land2}" />`);
  lines.push(`    </linearGradient>`);
  lines.push(`    <linearGradient id="sea-${id}" x1="0%" y1="0%" x2="100%" y2="100%">`);
  lines.push(`      <stop offset="0%" stop-color="${palette.seaDeep}" />`);
  lines.push(`      <stop offset="100%" stop-color="${palette.seaMid}" />`);
  lines.push(`    </linearGradient>`);
  lines.push(`    <pattern id="grid-${id}" width="80" height="80" patternUnits="userSpaceOnUse">`);
  lines.push(`      <path d="M 80 0 L 0 0 0 80" fill="none" stroke="rgba(15,23,42,0.045)" stroke-width="1"/>`);
  lines.push(`    </pattern>`);
  lines.push(`    <pattern id="fields-${id}" width="48" height="48" patternUnits="userSpaceOnUse" patternTransform="rotate(24)">`);
  lines.push(`      <rect width="24" height="24" fill="${palette.fieldA}" fill-opacity="0.22" />`);
  lines.push(`      <rect x="24" y="24" width="24" height="24" fill="${palette.fieldB}" fill-opacity="0.2" />`);
  lines.push(`    </pattern>`);
  lines.push(`  </defs>`);

  // 1. Base ocean or base land
  if (coastProfile) {
    lines.push(`  <rect width="${width}" height="${height}" fill="url(#sea-${id})" />`);
    // Subtle ocean bathymetry / wave texture lines
    for (let y = 38; y < height; y += 54) {
      const shift = (y % 108) * 0.4;
      lines.push(
        `  <path d="M 0 ${y} Q ${Math.round(width * 0.25 + shift)} ${y - 12} ${Math.round(width * 0.5)} ${y} T ${width} ${y}" fill="none" stroke="${palette.seaShallow}" stroke-opacity="0.22" stroke-width="2" />`
      );
    }

    // Shallow turquoise shelf ring (landScore >= -38)
    const shelfLoops = closedIsoBands(landGrid, cols, rows, -38, width, height).filter((lp) => lp.length >= 4);
    if (shelfLoops.length > 0) {
      lines.push(`  <g fill="${palette.seaShallow}" fill-opacity="0.55" stroke="none">`);
      for (const lp of shelfLoops) lines.push(`    <path d="${chaikinPath(lp, true)}" />`);
      lines.push(`  </g>`);
    }

    // Beach / shoreline rim (landScore >= -10)
    const beachLoops = closedIsoBands(landGrid, cols, rows, -10, width, height).filter((lp) => lp.length >= 4);
    if (beachLoops.length > 0) {
      lines.push(`  <g fill="${palette.beach}" stroke="${palette.seaShallow}" stroke-width="3.5" stroke-opacity="0.8">`);
      for (const lp of beachLoops) lines.push(`    <path d="${chaikinPath(lp, true)}" />`);
      lines.push(`  </g>`);
    }

    // Main landmass interior (landScore >= 0)
    const landLoops = closedIsoBands(landGrid, cols, rows, 0, width, height).filter((lp) => lp.length >= 4);
    if (landLoops.length > 0) {
      lines.push(`  <g fill="url(#bg-${id})" stroke="${palette.coastStroke}" stroke-width="1.8" stroke-opacity="0.55">`);
      for (const lp of landLoops) lines.push(`    <path d="${chaikinPath(lp, true)}" />`);
      lines.push(`  </g>`);
    }
  } else {
    lines.push(`  <rect width="${width}" height="${height}" fill="url(#bg-${id})" />`);
  }

  // Patchwork fields for agricultural / rural worlds
  if (biome === 'flanders' || biome === 'france' || biome === 'colombia') {
    lines.push(`  <rect width="${width}" height="${height}" fill="url(#fields-${id})" opacity="${coastProfile ? 0.22 : 0.45}" />`);
  }

  // 2. Hypsometric Elevation Zones + NW Directional Hillshade (masked visually by contour bands)
  const bandLevels = [
    { frac: 0.22, fill: palette.tier1, op: 0.42 },
    { frac: 0.38, fill: palette.tier2, op: 0.48 },
    { frac: 0.56, fill: palette.tier3, op: 0.55 },
    { frac: 0.74, fill: palette.tier4, op: 0.62 },
    { frac: 0.88, fill: palette.tier5, op: 0.72 },
  ];

  // For coastal islands, mask elevation bands inside land (set underwater elevation below minEle)
  const maskedEleGrid = Array.from({ length: rows }, (_, r) => {
    const arr = new Float32Array(cols);
    for (let c = 0; c < cols; c++) {
      arr[c] = coastProfile && landGrid[r][c] < 2 ? minEle - 999 : eleGrid[r][c];
    }
    return arr;
  });

  for (const band of bandLevels) {
    const lvl = minEle + eleSpan * band.frac;
    const loops = closedIsoBands(maskedEleGrid, cols, rows, lvl, width, height).filter((lp) => lp.length >= 4);
    if (loops.length > 0) {
      const ds = loops.map((lp) => chaikinPath(lp, true));
      lines.push(`  <g transform="translate(8,10)" fill="rgba(15,23,42,0.13)" stroke="none">`);
      for (const d of ds) lines.push(`    <path d="${d}" />`);
      lines.push(`  </g>`);
      lines.push(`  <g transform="translate(-3,-3)" fill="rgba(255,250,235,0.20)" stroke="none">`);
      for (const d of ds) lines.push(`    <path d="${d}" />`);
      lines.push(`  </g>`);
      lines.push(`  <g fill="${band.fill}" fill-opacity="${band.op}" stroke="none">`);
      for (const d of ds) lines.push(`    <path d="${d}" />`);
      lines.push(`  </g>`);
    }
  }

  // Crisp topographic contour lines
  const contourFracs = [0.22, 0.34, 0.46, 0.58, 0.70, 0.82, 0.91];
  for (let i = 0; i < contourFracs.length; i++) {
    const lvl = minEle + eleSpan * contourFracs[i];
    const isIndex = i % 2 === 1;
    const traces = marchingSquaresPolylines(maskedEleGrid, cols, rows, lvl, cellW, cellH, false);
    if (traces.length > 0) {
      lines.push(
        `  <g fill="none" stroke="${palette.contourLine}" stroke-opacity="${isIndex ? '0.42' : '0.24'}" stroke-width="${isIndex ? '1.6' : '0.9'}" stroke-linecap="round">`
      );
      for (const tr of traces) {
        lines.push(`    <path d="${chaikinPath(tr, false)}" />`);
      }
      lines.push(`  </g>`);
    }
  }

  // 3. Desert Dunes & Canyon Mesas (for AlUla / Arabia / California inland / Crimson Sands)
  for (const dz of duneZones) {
    const [cx, cy] = dz.nx !== undefined ? [dz.nx * width, dz.ny * height] : project(dz.lat, dz.lon);
    const rx = (dz.rxFrac ?? 0.14) * width;
    const ry = (dz.ryFrac ?? 0.09) * height;
    const count = dz.count ?? 5;
    for (let i = 0; i < count; i++) {
      const oy = cy - ry * 0.65 + (i / Math.max(1, count - 1)) * ry * 1.3;
      const ox = cx + (i % 2 === 0 ? -rx * 0.15 : rx * 0.12);
      const w = rx * (0.75 + hash2(i, cx, seed) * 0.45);
      lines.push(
        `  <path d="M ${(ox - w).toFixed(1)} ${oy.toFixed(1)} Q ${(ox - w * 0.2).toFixed(1)} ${(oy - 22).toFixed(1)} ${ox.toFixed(1)} ${(oy - 4).toFixed(1)} T ${(ox + w).toFixed(1)} ${(oy + 6).toFixed(1)}" fill="none" stroke="#f7e3bd" stroke-opacity="0.58" stroke-width="5" stroke-linecap="round" />`
      );
      lines.push(
        `  <path d="M ${(ox - w).toFixed(1)} ${(oy + 3).toFixed(1)} Q ${(ox - w * 0.2).toFixed(1)} ${(oy - 18).toFixed(1)} ${ox.toFixed(1)} ${(oy - 1).toFixed(1)} T ${(ox + w).toFixed(1)} ${(oy + 9).toFixed(1)}" fill="none" stroke="#9c6b3b" stroke-opacity="0.42" stroke-width="3.2" stroke-linecap="round" />`
      );
    }
  }

  for (const cz of canyonZones) {
    const [cx, cy] = cz.nx !== undefined ? [cz.nx * width, cz.ny * height] : project(cz.lat, cz.lon);
    const r = (cz.rFrac ?? 0.065) * Math.min(width, height);
    const ptsOut = [];
    const ptsIn = [];
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      const rad = r * (0.75 + hash2(k, Math.round(cx), seed + 5) * 0.45);
      ptsOut.push(`${(cx + Math.cos(ang) * rad * 1.2).toFixed(1)},${(cy + Math.sin(ang) * rad).toFixed(1)}`);
      ptsIn.push(`${(cx + Math.cos(ang) * rad * 0.68).toFixed(1)},${(cy + Math.sin(ang) * rad * 0.56).toFixed(1)}`);
    }
    lines.push(`  <polygon points="${ptsOut.join(' ')}" fill="#9b5c34" fill-opacity="0.46" stroke="#69391b" stroke-opacity="0.55" stroke-width="2" />`);
    lines.push(`  <polygon points="${ptsIn.join(' ')}" fill="#c47f4f" fill-opacity="0.55" stroke="#fde6c4" stroke-opacity="0.45" stroke-width="1.4" />`);
  }

  // 4. Custom Lakes & Inland Water Polygons + Rivers
  for (const poly of customWaterPolys) {
    const pts = poly.map((p) => (Array.isArray(p) && p.length === 2 && Math.abs(p[0]) <= 1 && Math.abs(p[1]) <= 1 && p[0] >= 0 ? [p[0] * width, p[1] * height] : project(p[0], p[1])));
    lines.push(
      `  <path d="${chaikinPath(pts, true)}" fill="${palette.seaShallow}" fill-opacity="0.88" stroke="${palette.seaMid}" stroke-width="3" />`
    );
    lines.push(
      `  <path d="${chaikinPath(pts, true)}" fill="none" stroke="${palette.beach}" stroke-opacity="0.65" stroke-width="5" stroke-linejoin="round" />`
    );
  }

  for (const r of riverPaths) {
    const pts = r.map((p) => (p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1 ? [p[0] * width, p[1] * height] : project(p[0], p[1])));
    const d = chaikinPath(pts, false);
    lines.push(`  <path d="${d}" fill="none" stroke="${palette.beach}" stroke-width="22" stroke-linecap="round" stroke-opacity="0.55" />`);
    lines.push(`  <path d="${d}" fill="none" stroke="${palette.seaMid}" stroke-width="14" stroke-linecap="round" stroke-opacity="0.88" />`);
    lines.push(`  <path d="${d}" fill="none" stroke="${palette.seaShallow}" stroke-width="6" stroke-linecap="round" stroke-opacity="0.72" />`);
  }

  // 5. Lush Forests, Bamboo / Palm Oases & Parks
  for (const fz of forestZones) {
    const [cx, cy] = fz.nx !== undefined ? [fz.nx * width, fz.ny * height] : project(fz.lat, fz.lon);
    const rx = (fz.rFrac ?? 0.08) * width;
    const ry = (fz.rFrac ?? 0.08) * height;
    lines.push(`  <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="${(rx * 1.15).toFixed(1)}" ry="${(ry * 0.95).toFixed(1)}" fill="${fz.color || palette.forest}" fill-opacity="0.34" />`);
    const treeCount = fz.trees ?? 16;
    for (let i = 0; i < treeCount; i++) {
      const ang = hash2(i, Math.round(cx), seed + 11) * Math.PI * 2;
      const dist = Math.sqrt(hash2(i, Math.round(cy), seed + 23)) * 0.92;
      const tx = cx + Math.cos(ang) * rx * dist;
      const ty = cy + Math.sin(ang) * ry * dist;
      const tr = 6 + hash2(i, tx, seed + 31) * 7;
      lines.push(`  <circle cx="${(tx + 2).toFixed(1)}" cy="${(ty + 2).toFixed(1)}" r="${tr.toFixed(1)}" fill="rgba(15,23,42,0.16)" />`);
      lines.push(`  <circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="${tr.toFixed(1)}" fill="${fz.color || palette.forest}" fill-opacity="0.82" stroke="${fz.stroke || palette.forestDark}" stroke-width="1.2" />`);
    }
  }

  // 6. Urban Districts, Towns & Special Landmarks (Velodrome, Skill Park, Bridges, Peaks, Temples)
  for (const uz of urbanZones) {
    const [cx, cy] = uz.nx !== undefined ? [uz.nx * width, uz.ny * height] : project(uz.lat, uz.lon);
    const span = (uz.rFrac ?? 0.045) * Math.min(width, height);
    const bCount = uz.blocks ?? 14;
    lines.push(`  <circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(span * 1.05).toFixed(1)}" fill="${uz.baseColor || 'rgba(148,163,184,0.22)'}" />`);
    for (let i = 0; i < bCount; i++) {
      const ox = (hash2(i, Math.round(cx), seed + 51) - 0.5) * span * 1.6;
      const oy = (hash2(i, Math.round(cy), seed + 61) - 0.5) * span * 1.4;
      const bw = 9 + hash2(i, Math.round(ox), seed + 71) * 14;
      const bh = 8 + hash2(i, Math.round(oy), seed + 81) * 13;
      const rot = Math.round((hash2(i, 3, seed) - 0.5) * 28);
      lines.push(
        `  <rect x="${(cx + ox - bw / 2).toFixed(1)}" y="${(cy + oy - bh / 2).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" transform="rotate(${rot} ${(cx + ox).toFixed(1)} ${(cy + oy).toFixed(1)})" fill="${uz.roofColor || '#cbd5e1'}" fill-opacity="0.88" stroke="${uz.strokeColor || '#475569'}" stroke-width="1.1" />`
      );
    }
  }

  for (const sf of specialFeatures) {
    const [cx, cy] = sf.nx !== undefined ? [sf.nx * width, sf.ny * height] : project(sf.lat, sf.lon);
    if (sf.kind === 'velodrome') {
      lines.push(`  <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="28" ry="17" transform="rotate(-20 ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="#e2e8f0" stroke="#0284c7" stroke-width="3.5" />`);
      lines.push(`  <ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="18" ry="9" transform="rotate(-20 ${cx.toFixed(1)} ${cy.toFixed(1)})" fill="#22c55e" fill-opacity="0.72" />`);
    } else if (sf.kind === 'bridge' && sf.toLat !== undefined) {
      const [bx, by] = project(sf.toLat, sf.toLon);
      lines.push(`  <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#1e293b" stroke-width="11" stroke-linecap="round" />`);
      lines.push(`  <line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}" stroke="#f8fafc" stroke-width="6.5" stroke-dasharray="10 5" stroke-linecap="round" />`);
    } else if (sf.kind === 'volcano') {
      lines.push(`  <polygon points="${cx.toFixed(1)},${(cy - 34).toFixed(1)} ${(cx + 38).toFixed(1)},${(cy + 20).toFixed(1)} ${(cx - 38).toFixed(1)},${(cy + 20).toFixed(1)}" fill="#64748b" stroke="#334155" stroke-width="2" />`);
      lines.push(`  <polygon points="${cx.toFixed(1)},${(cy - 34).toFixed(1)} ${(cx + 15).toFixed(1)},${(cy - 12).toFixed(1)} ${(cx + 6).toFixed(1)},${(cy - 15).toFixed(1)} ${cx.toFixed(1)},${(cy - 10).toFixed(1)} ${(cx - 7).toFixed(1)},${(cy - 15).toFixed(1)} ${(cx - 15).toFixed(1)},${(cy - 12).toFixed(1)}" fill="#ffffff" />`);
    }
  }

  // Subtle cartographic grid on top of terrain
  lines.push(`  <rect width="${width}" height="${height}" fill="url(#grid-${id})" />`);

  // 7. Deduplicated Road Network (clean, readable under user route)
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

  lines.push(`  <g stroke="rgba(15,23,42,0.28)" stroke-width="9.5" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);
  lines.push(`  <g stroke="#334155" stroke-width="6.4" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);
  lines.push(`  <g stroke="#f8fafc" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);
  lines.push(`  <g stroke="${palette.roadCenter}" stroke-opacity="0.45" stroke-width="1.1" stroke-dasharray="6 6" stroke-linecap="round" fill="none">`);
  for (const d of allMain) lines.push(`    <path d="${d}" />`);
  lines.push(`  </g>`);

  if (dashedPaths.length > 0) {
    lines.push(`  <g stroke="#1e293b" stroke-width="6.0" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.8">`);
    for (const d of dashedPaths) lines.push(`    <path d="${d}" />`);
    lines.push(`  </g>`);
    lines.push(`  <g stroke="#67e8f9" stroke-width="3.0" stroke-dasharray="10 6" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-opacity="0.92">`);
    for (const d of dashedPaths) lines.push(`    <path d="${d}" />`);
    lines.push(`  </g>`);
  }

  // 8. Landmarks with collision avoidance
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
        `  <rect x="${chosen.x0.toFixed(1)}" y="${chosen.y0.toFixed(1)}" width="${pillW.toFixed(1)}" height="${pillH}" rx="6" fill="rgba(15,23,42,0.84)" stroke="rgba(255,255,255,0.18)" stroke-width="1" />`
      );
      lines.push(
        `  <text x="${(chosen.x0 + 9).toFixed(1)}" y="${(chosen.y0 + 15).toFixed(1)}" font-family="system-ui,-apple-system,sans-serif" font-size="11.5" font-weight="700" fill="#f8fafc">${escXml(label)}</text>`
      );
    }
  }

  // Compass rose bottom-right
  const crx = width - 48;
  const cry = height - 48;
  lines.push(`  <g transform="translate(${crx}, ${cry})" opacity="0.92">`);
  lines.push(`    <circle cx="0" cy="0" r="24" fill="rgba(15,23,42,0.84)" stroke="rgba(255,255,255,0.24)" stroke-width="1.5"/>`);
  lines.push(`    <polygon points="0,-16 4.5,0 0,-3 -4.5,0" fill="#f97316"/>`);
  lines.push(`    <polygon points="0,16 4.5,0 0,3 -4.5,0" fill="#cbd5e1"/>`);
  lines.push(`    <text x="0" y="2" text-anchor="middle" font-family="system-ui,sans-serif" font-size="9" font-weight="800" fill="#ffffff" stroke="rgba(15,23,42,0.9)" stroke-width="2.4" paint-order="stroke">N</text>`);
  lines.push(`  </g>`);

  // Title card bottom-left
  const badgeY = height - 76;
  const badgeW = Math.min(width - 120, Math.max(320, subtitle.length * 6.5 + 80));
  lines.push(`  <rect x="22" y="${badgeY}" width="${badgeW}" height="54" rx="12" fill="rgba(15,23,42,0.86)" stroke="rgba(255,255,255,0.18)" />`);
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
  sand: {
    land0: '#f0dfbe', land1: '#e6c999', land2: '#d5ad76',
    tier1: '#dfba82', tier2: '#d19e61', tier3: '#ba7c42', tier4: '#9d5c2b', tier5: '#7c411c',
    contourLine: '#7a4620', beach: '#f7ead0', coastStroke: '#b2864d',
    seaDeep: '#2b7ea1', seaMid: '#4da7c4', seaShallow: '#7fd4dd',
    forest: '#5c914d', forestDark: '#3c6831', fieldA: '#d9be8b', fieldB: '#cca970',
    roadCenter: '#f59e0b', accent: '#f97316',
  },
  desertGulf: {
    land0: '#efe1c6', land1: '#e4cca4', land2: '#d5b282',
    tier1: '#dcbe8f', tier2: '#cca16b', tier3: '#b78349', tier4: '#966130', tier5: '#754620',
    contourLine: '#784c25', beach: '#f7ebd2', coastStroke: '#ab8755',
    seaDeep: '#1d759b', seaMid: '#3ca3c4', seaShallow: '#77d7df',
    forest: '#609352', forestDark: '#3f6a34', fieldA: '#dec79d', fieldB: '#ceb181',
    roadCenter: '#f59e0b', accent: '#f59e0b',
  },
  island: {
    land0: '#e2ecd4', land1: '#d2e2bd', land2: '#bfd3a7',
    tier1: '#d9d8aa', tier2: '#d8be82', tier3: '#c89b5d', tier4: '#b07a42', tier5: '#8f5a2b',
    contourLine: '#6b5f3d', beach: '#f5e4bc', coastStroke: '#9bb388',
    seaDeep: '#196f98', seaMid: '#329dc2', seaShallow: '#6bd8df',
    forest: '#4e9453', forestDark: '#316836', fieldA: '#c6dbaf', fieldB: '#b4ce9a',
    roadCenter: '#06b6d4', accent: '#06b6d4',
  },
  flanders: {
    land0: '#d7e6c3', land1: '#c6dbb0', land2: '#b3cd9a',
    tier1: '#b8d19b', tier2: '#9ec080', tier3: '#86ab68', tier4: '#728f57', tier5: '#5c7544',
    contourLine: '#4a6337', beach: '#e6deb8', coastStroke: '#6d8c59',
    seaDeep: '#28779e', seaMid: '#4da3c7', seaShallow: '#85cee0',
    forest: '#3d7d44', forestDark: '#26562b', fieldA: '#cde0b2', fieldB: '#b9d198',
    roadCenter: '#10b981', accent: '#10b981',
  },
  andes: {
    land0: '#cbe2bf', land1: '#b5d4a8', land2: '#9dc290',
    tier1: '#9ec48e', tier2: '#7fb072', tier3: '#68995f', tier4: '#8b8f5c', tier5: '#a48f71',
    contourLine: '#44683f', beach: '#e3dcb8', coastStroke: '#598055',
    seaDeep: '#247399', seaMid: '#489ec2', seaShallow: '#82cadb',
    forest: '#2e7d47', forestDark: '#1b552e', fieldA: '#a7cc96', fieldB: '#8fba7d',
    roadCenter: '#eab308', accent: '#eab308',
  },
  coastGreen: {
    land0: '#d4e6ca', land1: '#bfd9b5', land2: '#a8c99e',
    tier1: '#b1d1a3', tier2: '#93bd84', tier3: '#77a368', tier4: '#698a5a', tier5: '#847b60',
    contourLine: '#486a42', beach: '#f5e4bc', coastStroke: '#6d8f66',
    seaDeep: '#196f98', seaMid: '#359ec2', seaShallow: '#6ed5dd',
    forest: '#368049', forestDark: '#20592f', fieldA: '#bcd8ae', fieldB: '#a9ca99',
    roadCenter: '#22c55e', accent: '#22c55e',
  },
  california: {
    land0: '#e6e2be', land1: '#d7d1a3', land2: '#c5bc89',
    tier1: '#cbbd87', tier2: '#ba9f67', tier3: '#a6824d', tier4: '#8d653b', tier5: '#754e2b',
    contourLine: '#6b4d2b', beach: '#f5e4ba', coastStroke: '#8d8b61',
    seaDeep: '#1c6d96', seaMid: '#3b98bf', seaShallow: '#74cedb',
    forest: '#3c7a49', forestDark: '#23532d', fieldA: '#d4cc98', fieldB: '#c2b980',
    roadCenter: '#ec4899', accent: '#ec4899',
  },
  japan: {
    land0: '#d8e4cf', land1: '#c4d6bb', land2: '#aec5a4',
    tier1: '#a9c79f', tier2: '#89b080', tier3: '#6f966a', tier4: '#7b8577', tier5: '#edf2f7',
    contourLine: '#48634d', beach: '#efe2be', coastStroke: '#68826b',
    seaDeep: '#1d6c94', seaMid: '#3d98be', seaShallow: '#77cddb',
    forest: '#347a4c', forestDark: '#1e5230', fieldA: '#c4d8b6', fieldB: '#b1c9a0',
    roadCenter: '#f43f5e', accent: '#f43f5e',
  },
  swiss: {
    land0: '#d6e6d1', land1: '#c1d8be', land2: '#a8c6a6',
    tier1: '#a8cca1', tier2: '#87b382', tier3: '#6c986a', tier4: '#7e8e82', tier5: '#edf2f7',
    contourLine: '#44634b', beach: '#e8e2c5', coastStroke: '#5f8066',
    seaDeep: '#22729c', seaMid: '#469fc7', seaShallow: '#80cfe3',
    forest: '#2f7545', forestDark: '#1b4f2b', fieldA: '#bdd6b4', fieldB: '#a8c79d',
    roadCenter: '#ef4444', accent: '#ef4444',
  },
  france: {
    land0: '#d9e7c5', land1: '#c6dab0', land2: '#b0ca98',
    tier1: '#b2cf99', tier2: '#93ba78', tier3: '#74a05c', tier4: '#65864f', tier5: '#7d8366',
    contourLine: '#476638', beach: '#e9e0b8', coastStroke: '#688754',
    seaDeep: '#24749c', seaMid: '#49a0c4', seaShallow: '#82cee0',
    forest: '#35783f', forestDark: '#1f5226', fieldA: '#cde0b2', fieldB: '#b9d198',
    roadCenter: '#3b82f6', accent: '#3b82f6',
  },
  alpine: {
    land0: '#d4dfdc', land1: '#becfc9', land2: '#a6bcb4',
    tier1: '#9fbca9', tier2: '#80a18c', tier3: '#6d827a', tier4: '#8c949c', tier5: '#f1f5f9',
    contourLine: '#485966', beach: '#e5dfc3', coastStroke: '#627874',
    seaDeep: '#237099', seaMid: '#469bc2', seaShallow: '#80cde0',
    forest: '#2e6e48', forestDark: '#1a472d', fieldA: '#bccfc5', fieldB: '#a8bfb3',
    roadCenter: '#a855f7', accent: '#a855f7',
  },
  futuristic: {
    land0: '#cce0dc', land1: '#b5d0cc', land2: '#9abdb9',
    tier1: '#93bfba', tier2: '#78a8a8', tier3: '#94867e', tier4: '#b8684b', tier5: '#edf2f7',
    contourLine: '#446373', beach: '#efe0be', coastStroke: '#598288',
    seaDeep: '#186992', seaMid: '#3296bd', seaShallow: '#68d0dd',
    forest: '#29836a', forestDark: '#175745', fieldA: '#b4d1cb', fieldB: '#9dc0ba',
    roadCenter: '#38bdf8', accent: '#38bdf8',
  },
};

const GPX_WORLD_CONFIGS = [
  {
    id: 'alula',
    gpx: 'Alula.gpx',
    title: 'AlUla',
    subtitle: 'Arabia Saudí · 16 rutas · Máx 679m D+ · GPS Red Real',
    palette: PALETTES.sand,
    biome: 'desert',
    seed: 11,
    duneZones: [
      { lat: 26.565, lon: 37.785, rxFrac: 0.16, ryFrac: 0.12, count: 6 },
      { lat: 26.628, lon: 37.738, rxFrac: 0.14, ryFrac: 0.1, count: 5 },
      { lat: 26.555, lon: 37.734, rxFrac: 0.13, ryFrac: 0.09, count: 4 },
    ],
    canyonZones: [
      { lat: 26.609, lon: 37.761, rFrac: 0.07 },
      { lat: 26.595, lon: 37.756, rFrac: 0.05 },
      { lat: 26.638, lon: 37.790, rFrac: 0.055 },
      { lat: 26.572, lon: 37.747, rFrac: 0.05 },
    ],
    forestZones: [
      { lat: 26.610, lon: 37.743, rFrac: 0.05, trees: 14, color: '#4d8a3f', stroke: '#2c5922' },
      { lat: 26.562, lon: 37.758, rFrac: 0.045, trees: 12, color: '#539142', stroke: '#2e5d24' },
      { lat: 26.589, lon: 37.771, rFrac: 0.045, trees: 11, color: '#4d8a3f', stroke: '#2c5922' },
    ],
    urbanZones: [
      { lat: 26.582, lon: 37.733, rFrac: 0.045, blocks: 14, roofColor: '#e7d2b5', strokeColor: '#8f6c47' },
      { lat: 26.639, lon: 37.796, rFrac: 0.04, blocks: 12, roofColor: '#dfc39d', strokeColor: '#82603d' },
    ],
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
    biome: 'desert',
    seed: 19,
    coastProfile: {
      type: 'westBay',
      shoreX: (ny) => 1200 * (ny > 0.62 ? 0.34 : 0.12),
      roadKeepPx: 52,
      jitterPx: 38,
    },
    customWaterPolys: [
      [[23.368, 52.244], [23.376, 52.244], [23.377, 52.256], [23.367, 52.255]],
    ],
    duneZones: [
      { lat: 23.408, lon: 52.225, rxFrac: 0.16, ryFrac: 0.11, count: 6 },
      { lat: 23.465, lon: 52.228, rxFrac: 0.14, ryFrac: 0.09, count: 5 },
    ],
    canyonZones: [
      { lat: 23.498, lon: 52.187, rFrac: 0.075 },
      { lat: 23.435, lon: 52.267, rFrac: 0.068 },
    ],
    forestZones: [
      { lat: 23.371, lon: 52.249, rFrac: 0.04, trees: 10, color: '#4f8f45', stroke: '#2d5c26' },
      { lat: 23.441, lon: 52.212, rFrac: 0.038, trees: 9, color: '#559449', stroke: '#2d5c26' },
    ],
    urbanZones: [
      { lat: 23.395, lon: 52.180, rFrac: 0.05, blocks: 16, roofColor: '#e2e8f0', strokeColor: '#475569' },
      { lat: 23.360, lon: 52.203, rFrac: 0.045, blocks: 14, roofColor: '#e7d9be', strokeColor: '#786245' },
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
    biome: 'coastal',
    seed: 29,
    coastProfile: {
      type: 'eastSea',
      shoreX: (ny) => 1200 * (0.76 - ny * 0.08 + Math.sin(ny * 7) * 0.03),
      roadKeepPx: 54,
      jitterPx: 36,
    },
    riverPaths: [
      [[-21.028, 148.726], [-21.012, 148.738], [-20.998, 148.742], [-20.988, 148.778]],
    ],
    forestZones: [
      { lat: -21.025, lon: 148.732, rFrac: 0.095, trees: 22 },
      { lat: -21.005, lon: 148.746, rFrac: 0.06, trees: 14 },
      { lat: -21.013, lon: 148.763, rFrac: 0.055, trees: 13 },
    ],
    urbanZones: [
      { lat: -20.997, lon: 148.738, rFrac: 0.05, blocks: 16 },
      { lat: -20.998, lon: 148.777, rFrac: 0.045, blocks: 14 },
    ],
    specialFeatures: [
      { kind: 'bridge', lat: -20.999, lon: 148.734, toLat: -20.997, toLon: 148.739 },
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
    biome: 'flanders',
    seed: 37,
    riverPaths: [
      [[50.752, 3.532], [50.778, 3.541], [50.808, 3.553], [50.838, 3.546], [50.865, 3.552]],
    ],
    forestZones: [
      { lat: 50.796, lon: 3.594, rFrac: 0.08, trees: 20 },
      { lat: 50.825, lon: 3.563, rFrac: 0.06, trees: 14 },
      { lat: 50.783, lon: 3.518, rFrac: 0.055, trees: 13 },
      { lat: 50.772, lon: 3.570, rFrac: 0.055, trees: 12 },
    ],
    urbanZones: [
      { lat: 50.842, lon: 3.542, rFrac: 0.05, blocks: 16, roofColor: '#e2c5aa', strokeColor: '#7c4c30' },
      { lat: 50.810, lon: 3.552, rFrac: 0.042, blocks: 12, roofColor: '#deb896', strokeColor: '#7c4c30' },
      { lat: 50.760, lon: 3.494, rFrac: 0.045, blocks: 14, roofColor: '#e2c5aa', strokeColor: '#7c4c30' },
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
    biome: 'coastal',
    seed: 43,
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 72,
      jitterPx: 30,
      cutout: (nx, ny, dRoad) => {
        // West/south SF bay open water unless road crosses
        if (nx < 0.56 && ny > 0.72 && dRoad > 26) return -25;
        return 999;
      },
    },
    forestZones: [
      { lat: 38.399, lon: -120.403, rFrac: 0.075, trees: 20, color: '#27663b', stroke: '#164224' },
      { lat: 38.445, lon: -120.362, rFrac: 0.055, trees: 13 },
    ],
    duneZones: [
      { lat: 38.412, lon: -120.337, rxFrac: 0.11, ryFrac: 0.08, count: 4 },
    ],
    urbanZones: [
      { lat: 38.393, lon: -120.372, rFrac: 0.05, blocks: 16 },
      { lat: 38.447, lon: -120.340, rFrac: 0.048, blocks: 15, roofColor: '#f5d0fe', strokeColor: '#86198f' },
    ],
    specialFeatures: [
      { kind: 'bridge', lat: 38.391, lon: -120.394, toLat: 38.395, toLon: -120.386 },
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
    biome: 'colombia',
    seed: 53,
    riverPaths: [
      [[4.565, -72.815], [4.595, -72.805], [4.628, -72.792], [4.666, -72.775]],
    ],
    customWaterPolys: [
      [[4.576, -72.796], [4.583, -72.796], [4.584, -72.803], [4.577, -72.804]],
    ],
    forestZones: [
      { lat: 4.628, lon: -72.770, rFrac: 0.11, trees: 26, color: '#217340', stroke: '#114d28' },
      { lat: 4.573, lon: -72.806, rFrac: 0.065, trees: 14, color: '#398047', stroke: '#1e5429' },
      { lat: 4.618, lon: -72.845, rFrac: 0.065, trees: 14 },
    ],
    urbanZones: [
      { lat: 4.600, lon: -72.817, rFrac: 0.048, blocks: 14, roofColor: '#fde68a', strokeColor: '#92400e' },
      { lat: 4.580, lon: -72.800, rFrac: 0.042, blocks: 12, roofColor: '#fed7aa', strokeColor: '#9a3412' },
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
    biome: 'island',
    seed: 61,
    fixedBounds: [
      [23.330, 54.952],
      [23.416, 55.056],
    ],
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 54,
      jitterPx: 26,
      cutout: (nx, ny, dRoad) => {
        // Channel separating Hudayriyat Island (SW) from Abu Dhabi / Arcade Bay (NE)
        if (ny < 0.45 && nx < 0.56 && dRoad > 24) return -32;
        if (nx > 0.48 && ny > 0.42 && dRoad > 34) return -32;
        return 999;
      },
    },
    dashedTracks: extra['hudayriyat-arcade'].tracks,
    forestZones: [
      { lat: 23.361, lon: 54.978, rFrac: 0.045, trees: 13 },
      { lat: 23.346, lon: 54.974, rFrac: 0.04, trees: 11 },
      { lat: 23.404, lon: 55.034, rFrac: 0.04, trees: 10 },
    ],
    urbanZones: [
      { lat: 23.374, lon: 54.975, rFrac: 0.036, blocks: 10, roofColor: '#e2e8f0', strokeColor: '#475569' },
      { lat: 23.402, lon: 55.036, rFrac: 0.035, blocks: 9, roofColor: '#cbd5e1', strokeColor: '#334155' },
    ],
    specialFeatures: [
      { kind: 'velodrome', lat: 23.36374, lon: 54.98306 },
      { kind: 'bridge', lat: 23.370, lon: 54.974, toLat: 23.376, toLon: 54.975 },
    ],
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
    biome: 'coastal',
    seed: 71,
    coastProfile: {
      type: 'eastSea',
      shoreX: (ny) => 1200 * (ny > 0.3 ? 0.72 : 0.80),
      roadKeepPx: 50,
      jitterPx: 32,
    },
    riverPaths: [
      [[35.475, 135.140], [35.455, 135.158], [35.435, 135.174]],
    ],
    forestZones: [
      { lat: 35.448, lon: 135.163, rFrac: 0.06, trees: 16, color: '#2b7a4b', stroke: '#154d2b' },
      { lat: 35.426, lon: 135.125, rFrac: 0.075, trees: 18, color: '#397d54', stroke: '#1f5233' },
      { lat: 35.471, lon: 135.130, rFrac: 0.04, trees: 10, color: '#f472b6', stroke: '#9d174d' },
    ],
    urbanZones: [
      { lat: 35.468, lon: 135.140, rFrac: 0.055, blocks: 18, roofColor: '#cbd5e1', strokeColor: '#475569' },
      { lat: 35.437, lon: 135.166, rFrac: 0.05, blocks: 15, roofColor: '#e2c9b0', strokeColor: '#78350f' },
    ],
    specialFeatures: [
      { kind: 'volcano', lat: 35.40904, lon: 135.10357 },
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
    biome: 'fantasy',
    seed: 83,
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 74,
      jitterPx: 32,
    },
    customWaterPolys: [
      [[24.985, -71.015], [24.991, -71.015], [24.991, -71.009], [24.985, -71.009]],
    ],
    forestZones: [
      { lat: 25.012, lon: -71.003, rFrac: 0.075, trees: 18, color: '#10b981', stroke: '#065f46' },
      { lat: 24.991, lon: -71.013, rFrac: 0.05, trees: 12, color: '#22c55e', stroke: '#166534' },
    ],
    duneZones: [
      { lat: 24.994, lon: -70.996, rxFrac: 0.11, ryFrac: 0.08, count: 4 },
    ],
    urbanZones: [
      { lat: 24.995, lon: -71.006, rFrac: 0.052, blocks: 16, roofColor: '#bae6fd', strokeColor: '#0369a1' },
      { lat: 25.001, lon: -71.014, rFrac: 0.042, blocks: 12, roofColor: '#7dd3fc', strokeColor: '#0284c7' },
    ],
    specialFeatures: [
      { kind: 'volcano', lat: 25.00776, lon: -70.98016 },
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
    biome: 'swiss',
    seed: 97,
    elevationRange: [400, 920],
    bounds: [
      [47.314, 8.492],
      [47.405, 8.618],
    ],
    tracks: extra.switzerland.tracks,
    customWaterPolys: [
      [[47.314, 8.532], [47.367, 8.538], [47.364, 8.554], [47.314, 8.574]],
    ],
    riverPaths: [
      [[47.365, 8.544], [47.376, 8.541], [47.388, 8.531], [47.402, 8.515]],
    ],
    forestZones: [
      { lat: 47.394, lon: 8.560, rFrac: 0.085, trees: 20 },
      { lat: 47.378, lon: 8.572, rFrac: 0.075, trees: 18 },
      { lat: 47.344, lon: 8.512, rFrac: 0.08, trees: 18 },
    ],
    urbanZones: [
      { lat: 47.372, lon: 8.540, rFrac: 0.065, blocks: 20, roofColor: '#e2c5aa', strokeColor: '#7c4c30' },
      { lat: 47.390, lon: 8.526, rFrac: 0.045, blocks: 12, roofColor: '#cbd5e1', strokeColor: '#475569' },
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
    biome: 'france',
    seed: 103,
    elevationRange: [300, 900],
    bounds: [
      [47.276, 3.862],
      [47.324, 3.926],
    ],
    tracks: extra.france.tracks,
    customWaterPolys: [
      [[47.284, 3.902], [47.291, 3.902], [47.292, 3.914], [47.284, 3.912]],
    ],
    riverPaths: [
      [[47.278, 3.868], [47.295, 3.884], [47.308, 3.902], [47.321, 3.920]],
    ],
    forestZones: [
      { lat: 47.310, lon: 3.878, rFrac: 0.09, trees: 22 },
      { lat: 47.288, lon: 3.872, rFrac: 0.08, trees: 18 },
      { lat: 47.312, lon: 3.910, rFrac: 0.085, trees: 20 },
    ],
    urbanZones: [
      { lat: 47.291, lon: 3.882, rFrac: 0.045, blocks: 14, roofColor: '#e6c2a0', strokeColor: '#7c4c30' },
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
    biome: 'alpine',
    seed: 109,
    elevationRange: [1200, 3400],
    bounds: [
      [27.44, 89.6],
      [27.52, 89.7],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.24, 0.72], [0.36, 0.45], [0.56, 0.25], [0.78, 0.34], [0.72, 0.62], [0.48, 0.78], [0.24, 0.72]],
      [[0.36, 0.45], [0.52, 0.56], [0.72, 0.62]],
    ],
    riverPaths: [
      [[0.12, 0.88], [0.32, 0.68], [0.52, 0.58], [0.72, 0.75], [0.92, 0.88]],
    ],
    forestZones: [
      { nx: 0.35, ny: 0.62, rFrac: 0.09, trees: 20 },
      { nx: 0.68, ny: 0.50, rFrac: 0.085, trees: 18 },
    ],
    urbanZones: [
      { nx: 0.24, ny: 0.72, rFrac: 0.05, blocks: 14, roofColor: '#fca5a5', strokeColor: '#7f1d1d' },
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
    biome: 'france',
    seed: 113,
    elevationRange: [30, 260],
    bounds: [
      [45.492, -73.618],
      [45.524, -73.574],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.22, 0.68], [0.34, 0.35], [0.58, 0.24], [0.76, 0.44], [0.68, 0.74], [0.42, 0.78], [0.22, 0.68]],
    ],
    coastProfile: {
      type: 'eastSea',
      shoreX: (ny) => 1200 * (0.85 - ny * 0.06),
      roadKeepPx: 50,
      jitterPx: 30,
    },
    forestZones: [
      { nx: 0.54, ny: 0.46, rFrac: 0.12, trees: 24, color: '#c2410c', stroke: '#7c2d12' },
      { nx: 0.32, ny: 0.56, rFrac: 0.08, trees: 16, color: '#35783f', stroke: '#1f5226' },
    ],
    urbanZones: [
      { nx: 0.74, ny: 0.65, rFrac: 0.06, blocks: 18 },
      { nx: 0.24, ny: 0.68, rFrac: 0.05, blocks: 14 },
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
    biome: 'alpine',
    seed: 127,
    elevationRange: [200, 2650],
    bounds: [
      [25.002, -71.042],
      [25.062, -70.962],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.16, 0.80], [0.28, 0.66], [0.22, 0.52], [0.44, 0.46], [0.38, 0.32], [0.64, 0.28], [0.80, 0.18]],
    ],
    riverPaths: [
      [[0.10, 0.86], [0.38, 0.78], [0.65, 0.64], [0.88, 0.52]],
    ],
    forestZones: [
      { nx: 0.22, ny: 0.70, rFrac: 0.09, trees: 18 },
      { nx: 0.52, ny: 0.55, rFrac: 0.08, trees: 16 },
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
    biome: 'island',
    seed: 131,
    elevationRange: [0, 35],
    bounds: [
      [24.398, 54.328],
      [24.432, 54.372],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.22, 0.62], [0.36, 0.30], [0.74, 0.30], [0.82, 0.60], [0.56, 0.76], [0.22, 0.62]],
    ],
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 70,
      jitterPx: 26,
    },
    urbanZones: [
      { nx: 0.48, ny: 0.50, rFrac: 0.07, blocks: 18, roofColor: '#e2e8f0', strokeColor: '#0284c7' },
    ],
    forestZones: [
      { nx: 0.66, ny: 0.44, rFrac: 0.06, trees: 12 },
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
    palette: PALETTES.swiss,
    biome: 'swiss',
    seed: 137,
    elevationRange: [10, 220],
    bounds: [
      [24.44, 54.35],
      [24.49, 54.42],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.20, 0.66], [0.38, 0.28], [0.76, 0.34], [0.72, 0.72], [0.34, 0.76], [0.20, 0.66]],
    ],
    coastProfile: {
      type: 'southLake',
      shoreY: (nx, h) => h * (0.80 + Math.sin(nx * 5) * 0.04),
      roadKeepPx: 50,
      jitterPx: 24,
    },
    forestZones: [
      { nx: 0.54, ny: 0.48, rFrac: 0.08, trees: 18 },
    ],
    urbanZones: [
      { nx: 0.34, ny: 0.64, rFrac: 0.06, blocks: 16 },
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
    palette: PALETTES.andes,
    biome: 'colombia',
    seed: 149,
    elevationRange: [120, 780],
    bounds: [
      [24.50, 54.40],
      [24.55, 54.47],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.20, 0.68], [0.36, 0.30], [0.78, 0.28], [0.74, 0.68], [0.46, 0.78], [0.20, 0.68]],
    ],
    riverPaths: [
      [[0.12, 0.42], [0.44, 0.54], [0.76, 0.48], [0.92, 0.60]],
    ],
    forestZones: [
      { nx: 0.54, ny: 0.44, rFrac: 0.09, trees: 20 },
    ],
    urbanZones: [
      { nx: 0.28, ny: 0.64, rFrac: 0.055, blocks: 15 },
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
    biome: 'island',
    seed: 157,
    elevationRange: [5, 110],
    bounds: [
      [24.56, 54.45],
      [24.61, 54.52],
    ],
    tracks: [],
    syntheticCircuits: [
      [[0.18, 0.56], [0.34, 0.28], [0.54, 0.42], [0.74, 0.28], [0.84, 0.62], [0.58, 0.76], [0.18, 0.56]],
    ],
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 72,
      jitterPx: 28,
    },
    urbanZones: [
      { nx: 0.36, ny: 0.46, rFrac: 0.06, blocks: 16, roofColor: '#bae6fd', strokeColor: '#0369a1' },
      { nx: 0.70, ny: 0.50, rFrac: 0.055, blocks: 14, roofColor: '#a5f3fc', strokeColor: '#0e7490' },
    ],
    forestZones: [
      { nx: 0.52, ny: 0.62, rFrac: 0.06, trees: 14 },
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
    biome: 'swiss',
    seed: 163,
    elevationRange: [475, 760],
    bounds: [
      [46.355, 14.075],
      [46.375, 14.115],
    ],
    tracks: [],
    coastProfile: {
      type: 'lakeCenter',
      cx: 0.50,
      cy: 0.52,
      rx: 0.32,
      ry: 0.22,
      ix: 0.48,
      iy: 0.52,
      islandR: 48,
      jitterPx: 18,
    },
    forestZones: [
      { nx: 0.16, ny: 0.28, rFrac: 0.09, trees: 20 },
      { nx: 0.84, ny: 0.26, rFrac: 0.09, trees: 20 },
      { nx: 0.20, ny: 0.82, rFrac: 0.08, trees: 16 },
    ],
    urbanZones: [
      { nx: 0.80, ny: 0.68, rFrac: 0.048, blocks: 12, roofColor: '#fed7aa', strokeColor: '#9a3412' },
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
    coastProfile: cfg.coastProfile ?? null,
    riverPaths: cfg.riverPaths ?? [],
    customWaterPolys: cfg.customWaterPolys ?? [],
    forestZones: cfg.forestZones ?? [],
    urbanZones: cfg.urbanZones ?? [],
    duneZones: cfg.duneZones ?? [],
    canyonZones: cfg.canyonZones ?? [],
    specialFeatures: cfg.specialFeatures ?? [],
    biome: cfg.biome ?? 'temperate',
    seed: cfg.seed ?? 7,
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
    coastProfile: cfg.coastProfile ?? null,
    riverPaths: cfg.riverPaths ?? [],
    customWaterPolys: cfg.customWaterPolys ?? [],
    forestZones: cfg.forestZones ?? [],
    urbanZones: cfg.urbanZones ?? [],
    duneZones: cfg.duneZones ?? [],
    canyonZones: cfg.canyonZones ?? [],
    specialFeatures: cfg.specialFeatures ?? [],
    elevationRange: cfg.elevationRange ?? [0, 400],
    biome: cfg.biome ?? 'temperate',
    syntheticCircuits: cfg.syntheticCircuits ?? [],
    seed: cfg.seed ?? 7,
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
