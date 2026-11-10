import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const GPX_DIR = '/tmp/mw_maps';
const EXTRA_TRACKS_PATH = path.resolve('scripts/extra-world-tracks.json');
const FRANCE_GUIDE_PATH = path.resolve('scripts/france-guide.png');
const OUT_DIR = path.resolve('public/maps/mywhoosh');
const OUT_DATA_PATH = path.resolve('src/lib/mywhoosh-roads-data.json');

function mercY(latDeg) {
  const rad = Math.max(-85, Math.min(85, latDeg)) * (Math.PI / 180);
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

function getWorldDisplayBounds(bounds, mapRotationDeg = 0) {
  if (mapRotationDeg !== 90) return bounds;
  const [[south, west], [north, east]] = bounds;
  const latC = (south + north) / 2;
  const lonC = (west + east) / 2;
  const cosC = Math.cos((latC * Math.PI) / 180);
  const dSouth = latC - (east - lonC) * cosC;
  const dNorth = latC - (west - lonC) * cosC;
  const dWest = lonC + (south - latC) / cosC;
  const dEast = lonC + (north - latC) / cosC;
  return [
    [Number(dSouth.toFixed(6)), Number(dWest.toFixed(6))],
    [Number(dNorth.toFixed(6)), Number(dEast.toFixed(6))],
  ];
}

function toDisplayLatLon(lat, lon, bounds, mapRotationDeg = 0) {
  if (mapRotationDeg !== 90) return [lat, lon];
  const [[south, west], [north, east]] = bounds;
  const latC = (south + north) / 2;
  const lonC = (west + east) / 2;
  const cosC = Math.cos((latC * Math.PI) / 180);
  return [latC - (lon - lonC) * cosC, lonC + (lat - latC) / cosC];
}

function computeMercatorDimensions(displayBounds, fixedSize) {
  if (fixedSize) return { width: fixedSize[0], height: fixedSize[1] };
  const [[south, west], [north, east]] = displayBounds;
  const xSpanRad = (east - west) * (Math.PI / 180);
  const ySpanMerc = mercY(north) - mercY(south);
  const ratio = Math.max(0.55, Math.min(1.85, xSpanRad / (ySpanMerc || 1e-6)));
  const width = 1200;
  const height = Math.round(width / ratio);
  return { width, height };
}

function makeProjector(bounds, displayBounds, width, height, mapRotationDeg = 0) {
  const [[south, west], [north, east]] = displayBounds;
  const mNorth = mercY(north);
  const mSouth = mercY(south);
  const mSpan = mNorth - mSouth || 1e-6;
  const lonSpan = east - west || 1e-6;
  return (lat, lon) => {
    const [dLat, dLon] = toDisplayLatLon(lat, lon, bounds, mapRotationDeg);
    const x = ((dLon - west) / lonSpan) * width;
    const y = ((mNorth - mercY(dLat)) / mSpan) * height;
    return [x, y];
  };
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
    const name = nameMatch?.[1] || '';
    const segs = [...m[1].matchAll(/<trkseg>([\s\S]*?)<\/trkseg>/g)];
    const bodies = segs.length > 0 ? segs.map((s) => s[1]) : [m[1]];
    for (const body of bodies) {
      let run = [];
      for (const ptMatch of body.matchAll(/<trkpt\s+lat="([-0-9.]+)"\s+lon="([-0-9.]+)"(?:\s*\/>|>([\s\S]*?)<\/trkpt>)/g)) {
        const eleMatch = ptMatch[3]?.match(/<ele>([-0-9.]+)<\/ele>/);
        const lat = Number(ptMatch[1]);
        const lon = Number(ptMatch[2]);
        const ele = eleMatch ? Number(eleMatch[1]) : null;
        const pt = ele !== null && Number.isFinite(ele) ? [lat, lon, ele] : [lat, lon];
        if (run.length > 0) {
          const prev = run[run.length - 1];
          const cosLat = Math.cos((lat * Math.PI) / 180);
          const stepM = Math.hypot((lat - prev[0]) * 111320, (lon - prev[1]) * 111320 * cosLat);
          if (stepM > 300) {
            if (run.length > 4) tracks.push({ name, pts: run });
            run = [];
          }
        }
        run.push(pt);
      }
      if (run.length > 4) tracks.push({ name, pts: run });
    }
  }
  return tracks;
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

// Fast integer hash & value noise (no Math.sin overhead inside per-pixel loops)
function ihash(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) * 2.3283064365386963e-10;
}

function vnoise(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = ihash(ix, iy, seed);
  const b = ihash(ix + 1, iy, seed);
  const c = ihash(ix, iy + 1, seed);
  const d = ihash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, seed, octaves = 4) {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    val += amp * vnoise(x * freq, y * freq, seed + i * 31);
    norm += amp;
    amp *= 0.5;
    freq *= 2.04;
  }
  return val / norm;
}

function ridgedFbm(x, y, seed, octaves = 4) {
  let val = 0;
  let amp = 0.5;
  let freq = 1;
  let weight = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(2 * vnoise(x * freq, y * freq, seed + i * 37) - 1);
    n = n * n * weight;
    weight = Math.max(0.2, Math.min(1, n * 1.6));
    val += n * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.1;
  }
  return val / norm;
}

// Felzenszwalb & Huttenlocher O(W*H) exact Euclidean Distance Transform
function dt1d(f, d, v, z, n) {
  let k = 0;
  v[0] = 0;
  z[0] = -1e20;
  z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const dx = q - v[k];
    d[q] = dx * dx + f[v[k]];
  }
}

function computeDistanceField(mask, W, H, targetVal) {
  const INF = 1e9;
  const grid = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    grid[i] = mask[i] === targetVal ? 0 : INF;
  }
  const maxDim = Math.max(W, H);
  const f = new Float32Array(maxDim);
  const d = new Float32Array(maxDim);
  const v = new Int32Array(maxDim);
  const z = new Float32Array(maxDim + 1);

  // Columns
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) f[y] = grid[y * W + x];
    dt1d(f, d, v, z, H);
    for (let y = 0; y < H; y++) grid[y * W + x] = d[y];
  }
  // Rows
  for (let y = 0; y < H; y++) {
    const rowOff = y * W;
    for (let x = 0; x < W; x++) f[x] = grid[rowOff + x];
    dt1d(f, d, v, z, W);
    for (let x = 0; x < W; x++) grid[rowOff + x] = Math.sqrt(d[x]);
  }
  return grid;
}

function drawSegMask(mask, W, H, x0, y0, x1, y1, val = 1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 1.5));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    const x = Math.round(x0 + dx * t);
    const y = Math.round(y0 + dy * t);
    if (x >= 0 && x < W && y >= 0 && y < H) {
      mask[y * W + x] = val;
    }
  }
}

function pointInPoly(x, y, poly) {
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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(v, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1));
  return t * t * (3 - 2 * t);
}

function mixRgb(c0, c1, t) {
  const k = clamp(t);
  return [
    c0[0] + (c1[0] - c0[0]) * k,
    c0[1] + (c1[1] - c0[1]) * k,
    c0[2] + (c1[2] - c0[2]) * k,
  ];
}

// Rasterize crisp 3D heightmap + ray-marched shadows + coastal bathymetry glow + road network
async function renderWorldMapWebp(cfg) {
  const {
    id,
    bounds,
    mapRotationDeg = 0,
    fixedSize = null,
    tracks = [],
    dashedTracks = [],
    syntheticCircuits = [],
    landmarks = [],
    coastProfile = null,
    riverPaths = [],
    customWaterPolys = [],
    forestZones = [],
    urbanZones = [],
    specialFeatures = [],
    elevationRange = [0, 400],
    theme = 'temperate',
    seed = 17,
    franceGuidePath = null,
  } = cfg;

  const displayBounds = getWorldDisplayBounds(bounds, mapRotationDeg);
  const { width: W, height: H } = computeMercatorDimensions(displayBounds, fixedSize);
  const project = makeProjector(bounds, displayBounds, W, H, mapRotationDeg);

  // 1. Rasterize road network & bridge masks
  const mainRoadSeed = new Uint8Array(W * H);
  const dashedRoadSeed = new Uint8Array(W * H);
  const bridgeMask = new Uint8Array(W * H);
  const mainLoops = [];

  for (const tr of tracks) {
    const simp = simplifyDp(tr, 14);
    const pts = simp.map(([la, lo]) => project(la, lo));
    if (pts.length >= 6) mainLoops.push(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      drawSegMask(mainRoadSeed, W, H, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1);
    }
  }
  for (const ring of syntheticCircuits) {
    const pts = ring.map(([nx, ny]) => [nx * W, ny * H]);
    if (pts.length >= 4) mainLoops.push(pts);
    for (let i = 0; i < pts.length - 1; i++) {
      drawSegMask(mainRoadSeed, W, H, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1);
    }
  }
  for (const tr of dashedTracks) {
    const simp = simplifyDp(tr, 14);
    const pts = simp.map(([la, lo]) => project(la, lo));
    for (let i = 0; i < pts.length - 1; i++) {
      drawSegMask(dashedRoadSeed, W, H, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 1);
    }
  }
  for (const sf of specialFeatures) {
    if (sf.kind === 'bridge' && sf.toLat !== undefined) {
      const [ax, ay] = project(sf.lat, sf.lon);
      const [bx, by] = project(sf.toLat, sf.toLon);
      drawSegMask(bridgeMask, W, H, ax, ay, bx, by, 1);
    }
  }

  // Load France semantic guide if applicable (R=land, G=ele/snow/volcanic, B=extra roads)
  let guideBuf = null;
  if (franceGuidePath) {
    const { data } = await sharp(franceGuidePath)
      .resize(W, H, { kernel: 'lanczos3' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    guideBuf = data;
    for (let i = 0; i < W * H; i++) {
      if (guideBuf[i * 3 + 2] > 145 && guideBuf[i * 3] > 140) {
        mainRoadSeed[i] = 1;
      }
    }
  }

  const dRoadMain = computeDistanceField(mainRoadSeed, W, H, 1);
  const dRoadDashed = dashedTracks.length > 0 ? computeDistanceField(dashedRoadSeed, W, H, 1) : null;
  const dBridge = specialFeatures.some((s) => s.kind === 'bridge')
    ? computeDistanceField(bridgeMask, W, H, 1)
    : null;

  // 2. Rasterize inland rivers (with organic meandering) & lakes
  const waterSeed = new Uint8Array(W * H);
  for (let rIdx = 0; rIdx < riverPaths.length; rIdx++) {
    const rPath = riverPaths[rIdx];
    const pts = rPath.map((p) => (p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1 ? [p[0] * W, p[1] * H] : project(p[0], p[1])));
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const segLen = Math.hypot(bx - ax, by - ay);
      const subSteps = Math.max(4, Math.ceil(segLen / 12));
      const nxPerp = -(by - ay) / (segLen || 1);
      const nyPerp = (bx - ax) / (segLen || 1);
      let prevX = ax;
      let prevY = ay;
      for (let s = 1; s <= subSteps; s++) {
        const t = s / subSteps;
        const px0 = lerp(ax, bx, t);
        const py0 = lerp(ay, by, t);
        const endTaper = (i === 0 ? smoothstep(0, 0.3, t) : 1) * (i === pts.length - 2 ? smoothstep(1, 0.7, t) : 1);
        const bend = (fbm(px0 / W * 10, py0 / H * 10, seed + 173 + rIdx * 29, 3) - 0.5) * 42 * endTaper;
        const px = px0 + nxPerp * bend;
        const py = py0 + nyPerp * bend;
        drawSegMask(waterSeed, W, H, prevX, prevY, px, py, 1);
        prevX = px;
        prevY = py;
      }
    }
  }
  const dRiver = riverPaths.length > 0 ? computeDistanceField(waterSeed, W, H, 1) : null;

  const lakeMask = new Uint8Array(W * H);
  for (const poly of customWaterPolys) {
    const pts = poly.map((p) =>
      p[0] >= 0 && p[0] <= 1 && p[1] >= 0 && p[1] <= 1 ? [p[0] * W, p[1] * H] : project(p[0], p[1])
    );
    let minX = W, maxX = 0, minY = H, maxY = 0;
    for (const [px, py] of pts) {
      if (px < minX) minX = Math.floor(px);
      if (px > maxX) maxX = Math.ceil(px);
      if (py < minY) minY = Math.floor(py);
      if (py > maxY) maxY = Math.ceil(py);
    }
    minX = Math.max(0, minX - 2);
    maxX = Math.min(W - 1, maxX + 2);
    minY = Math.max(0, minY - 2);
    maxY = Math.min(H - 1, maxY + 2);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (pointInPoly(x, y, pts)) lakeMask[y * W + x] = 1;
      }
    }
  }
  const hasLakes = customWaterPolys.length > 0;
  const dLake = hasLakes ? computeDistanceField(lakeMask, W, H, 1) : null;
  const dLakeIn = hasLakes ? computeDistanceField(lakeMask, W, H, 0) : null;

  // 3. Build Land Mask (1 = land, 0 = sea/water)
  const landMask = new Uint8Array(W * H);
  const diag = Math.hypot(W, H);
  if (guideBuf) {
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        landMask[i] = guideBuf[i * 3] >= 120 ? 1 : 0;
      }
    }
  } else {
    for (let y = 0; y < H; y++) {
      const ny = y / H;
      for (let x = 0; x < W; x++) {
        const nx = x / W;
        const i = y * W + x;
        const dRoad = Math.min(dRoadMain[i], dRoadDashed ? dRoadDashed[i] : INF_DIST);
        let isLand = 1;

        if (coastProfile) {
          const warpX = (fbm(nx * 5.2, ny * 5.2, seed + 19, 3) - 0.5) * 0.04;
          const warpY = (fbm(nx * 5.2 + 4.1, ny * 5.2 + 7.3, seed + 29, 3) - 0.5) * 0.04;
          const nCoast = (fbm((nx + warpX) * 9.5, (ny + warpY) * 9.5, seed + 41, 4) - 0.5) * coastProfile.jitterPx;
          let score = 100;
          if (coastProfile.type === 'island') {
            const insideHull = coastProfile.fillLoops && mainLoops.some((lp) => pointInPoly(x, y, lp));
            const buf = coastProfile.bufferPx + nCoast;
            score = insideHull ? Math.max(buf * 0.45, buf - dRoad) : buf - dRoad;
            if (coastProfile.cutout) {
              score = Math.min(score, coastProfile.cutout(nx, ny, dRoad));
            }
          } else if (coastProfile.type === 'eastSea') {
            const sx = coastProfile.shoreX(ny, W) + nCoast;
            const keep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
            score = Math.max(sx - x, keep);
          } else if (coastProfile.type === 'westBay') {
            const sx = coastProfile.shoreX(ny, W) + nCoast;
            const keep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
            score = Math.max(x - sx, keep);
          } else if (coastProfile.type === 'southLake') {
            const sy = coastProfile.shoreY(nx, H) + nCoast;
            const keep = dRoad < coastProfile.roadKeepPx ? coastProfile.roadKeepPx - dRoad : -999;
            score = Math.max(sy - y, keep);
          } else if (coastProfile.type === 'lakeCenter') {
            const dx = (nx - coastProfile.cx) / coastProfile.rx;
            const dy = (ny - coastProfile.cy) / coastProfile.ry;
            const ang = Math.atan2(dy, dx);
            const lobe = 1 + 0.18 * Math.sin(ang * 2 + 0.7) + 0.09 * Math.cos(ang * 3 - 0.5);
            const lakeD = (Math.hypot(dx, dy) / lobe - 1) * W * 0.24 + nCoast * 1.5;
            const islandD = coastProfile.islandR
              ? coastProfile.islandR - Math.hypot(nx - coastProfile.ix, ny - coastProfile.iy) * W + nCoast * 0.35
              : -999;
            score = Math.max(lakeD, islandD);
          }
          isLand = score > 0 ? 1 : 0;
        }

        if (dLake && dLakeIn) {
          // Organic FBM-warped shoreline for inland lakes (zero straight polygonal edges)
          const lakeSdf = lakeMask[i] ? -dLakeIn[i] : dLake[i];
          const lakeWarp = (fbm(nx * 11, ny * 11, seed + 77, 3) - 0.5) * 34;
          if (lakeSdf + lakeWarp < 0 && dRoad > 5.5) isLand = 0;
        }
        if (dRiver) {
          const rw = 6.5 + (fbm(nx * 14, ny * 14, seed + 83, 2) - 0.5) * 4;
          if (dRiver[i] < rw && dRoad > 4.5) isLand = 0;
        }
        // Keep bridges & road approaches above water
        if (dBridge && dBridge[i] < 6) isLand = 1;
        landMask[i] = isLand;
      }
    }
  }

  const dSea = computeDistanceField(landMask, W, H, 1); // >0 in water (dist to land)
  const dLand = computeDistanceField(landMask, W, H, 0); // >0 on land (dist to water)

  // 4. Coarse GPX <ele> + Landmark IDW grid -> bilinear smooth elevation field
  const eleSamples = [];
  for (const tr of tracks) {
    const step = Math.max(1, Math.floor(tr.length / 220));
    for (let i = 0; i < tr.length; i += step) {
      const pt = tr[i];
      if (pt.length >= 3 && typeof pt[2] === 'number' && Number.isFinite(pt[2])) {
        const [px, py] = project(pt[0], pt[1]);
        eleSamples.push([px, py, pt[2]]);
      }
    }
  }
  for (const lm of landmarks) {
    if (typeof lm.eleM === 'number') {
      const [px, py] =
        typeof lm.nx === 'number' && typeof lm.ny === 'number'
          ? [lm.nx * W, lm.ny * H]
          : project(lm.lat, lm.lon);
      eleSamples.push([px, py, lm.eleM * 1.06]);
    }
  }

  const maxEle =
    eleSamples.length > 0
      ? Math.max(elevationRange[1] ?? 180, ...eleSamples.map((s) => s[2]))
      : elevationRange[1] ?? 400;
  const minEle =
    eleSamples.length > 0
      ? Math.min(0, ...eleSamples.map((s) => s[2]))
      : elevationRange[0] ?? 0;
  const eleSpan = Math.max(40, maxEle - minEle);

  const gCols = 140;
  const gRows = Math.max(96, Math.round((gCols * H) / W));
  const coarseEle = new Float32Array(gCols * gRows);
  for (let r = 0; r < gRows; r++) {
    const py = (r / (gRows - 1)) * (H - 1);
    for (let c = 0; c < gCols; c++) {
      const px = (c / (gCols - 1)) * (W - 1);
      if (eleSamples.length > 0) {
        let wSum = 0;
        let vSum = 0;
        for (let k = 0; k < eleSamples.length; k++) {
          const sx = eleSamples[k][0];
          const sy = eleSamples[k][1];
          const d2 = (px - sx) * (px - sx) + (py - sy) * (py - sy) + 320;
          const w = 1 / (d2 * Math.sqrt(d2));
          wSum += w;
          vSum += w * eleSamples[k][2];
        }
        coarseEle[r * gCols + c] = clamp((vSum / (wSum || 1) - minEle) / eleSpan, 0, 1.15);
      } else {
        coarseEle[r * gCols + c] = 0.25;
      }
    }
  }

  // Landmark peak boosts in normalized pixels
  const peakBoosts = [];
  for (const lm of landmarks) {
    if (typeof lm.eleM === 'number' && lm.eleM >= 120) {
      const [px, py] =
        typeof lm.nx === 'number' && typeof lm.ny === 'number'
          ? [lm.nx * W, lm.ny * H]
          : project(lm.lat, lm.lon);
      peakBoosts.push({
        px,
        py,
        amp: clamp(lm.eleM / Math.max(250, maxEle), 0.25, 1.0) * 0.42,
        rad: diag * 0.085,
      });
    }
  }

  // 5. Full-resolution continuous elevation buffer E[i] in [0..1]
  const ele = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ny = y / H;
    const gr = (y / (H - 1)) * (gRows - 1);
    const r0 = Math.min(gRows - 2, Math.floor(gr));
    const fy = gr - r0;
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const i = y * W + x;
      if (!landMask[i]) {
        ele[i] = 0;
        continue;
      }
      const gc = (x / (W - 1)) * (gCols - 1);
      const c0 = Math.min(gCols - 2, Math.floor(gc));
      const fx = gc - c0;
      const e00 = coarseEle[r0 * gCols + c0];
      const e10 = coarseEle[r0 * gCols + c0 + 1];
      const e01 = coarseEle[(r0 + 1) * gCols + c0];
      const e11 = coarseEle[(r0 + 1) * gCols + c0 + 1];
      const baseIdw = (e00 * (1 - fx) + e10 * fx) * (1 - fy) + (e01 * (1 - fx) + e11 * fx) * fy;

      const wx = (fbm(nx * 4.5, ny * 4.5, seed + 5, 3) - 0.5) * 0.24;
      const wy = (fbm(nx * 4.5 + 8.3, ny * 4.5 + 2.1, seed + 13, 3) - 0.5) * 0.24;
      const ridge = ridgedFbm((nx + wx) * 6.5, (ny + wy) * 6.5, seed + 53, 4);
      const hills = fbm((nx + wx * 0.5) * 3.8, (ny + wy * 0.5) * 3.8, seed + 67, 4);

      let h;
      if (guideBuf) {
        const gEle = guideBuf[i * 3 + 1] / 255;
        h = gEle * 0.86 + ridge * 0.09 + hills * 0.10;
      } else if (theme === 'desert' || theme === 'canyon') {
        const duneWave = Math.pow(0.5 + 0.5 * Math.sin((nx * 19 + ny * 7 + fbm(nx * 5, ny * 5, seed + 91, 3) * 2.4) * Math.PI), 1.3);
        const mesaRaw = ridge * 0.60 + hills * 0.40;
        // Smooth C1 sandstone terraces without discontinuous step cracks
        const mesa = theme === 'canyon' ? mesaRaw + Math.sin(mesaRaw * Math.PI * 5) * 0.032 : ridge * 0.72;
        h = baseIdw * 0.52 + mesa * 0.40 + duneWave * 0.11;
      } else {
        h = baseIdw * 0.56 + ridge * 0.34 + hills * 0.22;
      }

      for (let p = 0; p < peakBoosts.length; p++) {
        const pk = peakBoosts[p];
        const dist = Math.hypot(x - pk.px, y - pk.py);
        if (dist < pk.rad) {
          const k = 1 - dist / pk.rad;
          h += pk.amp * k * k * (0.65 + 0.35 * ridge);
        }
      }

      // Coastal shore drop-off (preserving dramatic cliffs on France NE & Alpine coasts)
      if (coastProfile || guideBuf) {
        const cliffFactor = guideBuf ? 0.55 + 0.45 * smoothstep(0.35, 0.7, ridge) : 0.35;
        const coastSlope = smoothstep(0, 14 + cliffFactor * 18, dLand[i]);
        h = h * (0.25 + 0.75 * coastSlope);
      }
      ele[i] = clamp(h, 0.01, 1.35);
    }
  }

  // Forest & urban pre-masks
  const forestCenters = forestZones.map((fz) => {
    const [cx, cy] = fz.nx !== undefined ? [fz.nx * W, fz.ny * H] : project(fz.lat, fz.lon);
    return { cx, cy, r: (fz.rFrac ?? 0.08) * Math.min(W, H), tint: fz.tint ?? null };
  });
  const urbanCenters = urbanZones.map((uz) => {
    const [cx, cy] = uz.nx !== undefined ? [uz.nx * W, uz.ny * H] : project(uz.lat, uz.lon);
    return { cx, cy, r: (uz.rFrac ?? 0.045) * Math.min(W, H) };
  });

  // 6. Shade every pixel with true surface normals + ray-marched NW cast shadows + AO + biomes + roads
  const rgba = Buffer.alloc(W * H * 4);
  const lx = -0.64, ly = -0.58, lz = 0.50;
  const shadowSteps = [2, 4, 7, 11, 16, 22, 30, 40, 52, 66];
  const reliefGain = theme === 'desert' ? 18 : theme === 'hudayriyat' ? 15 : 24;

  for (let y = 0; y < H; y++) {
    const ny = y / H;
    const ym = Math.max(0, y - 1);
    const yp = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const nx = x / W;
      const i = y * W + x;
      const p4 = i * 4;

      if (!landMask[i]) {
        // Deep ocean + turquoise coastal bathymetry glow
        const ds = dSea[i];
        const bathyNoise = fbm(nx * 8.5, ny * 8.5, seed + 109, 3) - 0.5;
        const glow = Math.exp(-ds / 24) * 0.82 + Math.exp(-ds / 64) * 0.18 + bathyNoise * 0.04 * Math.exp(-ds / 45);
        const rim = smoothstep(4.5, 0, ds);
        let col = mixRgb([11, 38, 56], [28, 96, 112], clamp(glow));
        col = mixRgb(col, [52, 165, 178], rim * 0.65);

        // Draw bridges cleanly spanning water
        if (dBridge && dBridge[i] < 4.5) {
          const dBr = dBridge[i];
          if (dBr < 2.2) col = [175, 173, 168];
          else col = mixRgb(col, [58, 65, 68], smoothstep(4.5, 2.2, dBr));
        }

        rgba[p4] = Math.round(clamp(col[0], 0, 255));
        rgba[p4 + 1] = Math.round(clamp(col[1], 0, 255));
        rgba[p4 + 2] = Math.round(clamp(col[2], 0, 255));
        rgba[p4 + 3] = 255;
        continue;
      }

      const xm = Math.max(0, x - 1);
      const xp = Math.min(W - 1, x + 1);
      const eC = ele[i];
      const gx = (ele[y * W + xp] - ele[y * W + xm]) * reliefGain;
      const gy = (ele[yp * W + x] - ele[ym * W + x]) * reliefGain;
      const slope = Math.hypot(gx, gy);

      const invN = 1 / Math.sqrt(gx * gx + gy * gy + 1);
      const nX = -gx * invN;
      const nY = -gy * invN;
      const nZ = invN;
      const ndotl = clamp(nX * lx + nY * ly + nZ * lz, 0, 1);

      // Ray-marched cast mountain shadow toward NW sun
      let occ = 0;
      for (let sIdx = 0; sIdx < shadowSteps.length; sIdx++) {
        const dist = shadowSteps[sIdx];
        const sx = Math.round(x + lx * dist);
        const sy = Math.round(y + ly * dist);
        if (sx < 0 || sx >= W || sy < 0 || sy >= H) break;
        const rayZ = eC + dist * 0.0085;
        const diff = ele[sy * W + sx] - rayZ;
        if (diff > 0) {
          occ = Math.max(occ, clamp(diff * 8.5, 0, 0.72));
        }
      }
      const shadow = 1 - occ;

      // Local valley ambient occlusion
      const yAo0 = Math.max(0, y - 6), yAo1 = Math.min(H - 1, y + 6);
      const xAo0 = Math.max(0, x - 6), xAo1 = Math.min(W - 1, x + 6);
      const avgNear = (ele[yAo0 * W + x] + ele[yAo1 * W + x] + ele[y * W + xAo0] + ele[y * W + xAo1]) * 0.25;
      const ao = clamp(1.0 + (eC - avgNear) * 2.2, 0.76, 1.08);

      // Micro texture noise (tree canopy clumps / sand grains / rocky crags)
      const canopyNoise = fbm(nx * 28, ny * 28, seed + 123, 3);
      const microNoise = fbm(nx * 64, ny * 64, seed + 149, 2);

      let baseCol;
      if (id === 'france') {
        const gEle = guideBuf[i * 3 + 1] / 255;
        const isVolcZone = nx > 0.35 && nx < 0.53 && ny > 0.06 && ny < 0.21 && gEle > 0.72;
        const isSnowZone = nx < 0.38 && ny > 0.64;
        const forestMix = smoothstep(0.38, 0.70, canopyNoise);
        let green = mixRgb([126, 154, 70], [60, 90, 40], forestMix * 0.82);
        green = mixRgb(green, [154, 178, 86], smoothstep(0.35, 0.70, eC) * 0.52);
        const cliffMix = smoothstep(0.42, 0.96, slope);
        baseCol = mixRgb(green, [88, 88, 74], cliffMix * 0.86);
        if (isVolcZone) {
          baseCol = mixRgb(baseCol, [148, 100, 50], smoothstep(0.72, 0.84, gEle) * 0.90);
        }
        if (isSnowZone) {
          const snowAmt = smoothstep(0.62, 0.78, gEle + (microNoise - 0.5) * 0.14);
          baseCol = mixRgb(baseCol, [240, 243, 246], snowAmt);
        }
      } else if (theme === 'desert' || theme === 'canyon') {
        const sandLight = [228, 198, 144];
        const sandWarm = [196, 150, 96];
        const mesaRock = theme === 'canyon' ? [142, 86, 48] : [132, 92, 54];
        const peakRock = [108, 82, 62];
        baseCol = mixRgb(sandWarm, sandLight, smoothstep(0.25, 0.75, canopyNoise));
        baseCol = mixRgb(baseCol, mesaRock, smoothstep(0.38, 0.95, slope + eC * 0.35));
        baseCol = mixRgb(baseCol, peakRock, smoothstep(0.72, 1.05, eC));
      } else if (theme === 'hudayriyat') {
        const sand = mixRgb([214, 192, 146], [230, 212, 172], canopyNoise);
        const park = mixRgb([84, 128, 52], [116, 156, 68], canopyNoise);
        const parkMask = smoothstep(0.45, 0.68, fbm(nx * 11, ny * 11, seed + 201, 3)) * smoothstep(28, 4, dRoadMain[i]);
        baseCol = mixRgb(sand, park, parkMask * 0.82);
        baseCol = mixRgb(baseCol, [118, 108, 92], smoothstep(0.42, 0.95, slope));
      } else if (theme === 'fantasy') {
        // MyWhoosh World: 6 distinct biomes (Snow SW, Lava NE, Dunes E, Forest N, Beach W, City center)
        const snowW = smoothstep(0.55, 0.25, nx) * smoothstep(0.55, 0.85, ny) + smoothstep(0.70, 0.95, ny) * 0.55;
        const lavaW = smoothstep(0.62, 0.86, nx) * smoothstep(0.52, 0.22, ny);
        const duneW = smoothstep(0.60, 0.84, nx) * smoothstep(0.35, 0.72, ny);
        const forestW = smoothstep(0.48, 0.20, ny) * (1 - lavaW);

        let col = mixRgb([108, 148, 66], [56, 98, 46], canopyNoise);
        col = mixRgb(col, [42, 114, 78], clamp(forestW * 0.78));
        col = mixRgb(col, [218, 186, 124], clamp(duneW * 0.85));
        // Lava Fields basalt + glowing orange magma veins
        const lavaCrack = smoothstep(0.84, 0.94, ridgedFbm(nx * 24, ny * 24, seed + 301, 2));
        const lavaCol = mixRgb([46, 36, 38], [238, 94, 16], lavaCrack * 0.9);
        col = mixRgb(col, lavaCol, clamp(lavaW));
        // Cliff & Snowfall Mountain
        col = mixRgb(col, [84, 86, 76], smoothstep(0.48, 1.05, slope) * (1 - snowW * 0.4));
        col = mixRgb(col, [236, 240, 244], clamp(snowW * smoothstep(0.38, 0.72, eC + snowW * 0.35)));
        baseCol = col;
      } else if (theme === 'colombia') {
        const jungle = mixRgb([44, 92, 38], [94, 142, 58], smoothstep(0.3, 0.75, canopyNoise));
        const paramo = mixRgb(jungle, [136, 152, 78], smoothstep(0.55, 0.85, eC));
        baseCol = mixRgb(paramo, [86, 88, 76], smoothstep(0.50, 1.15, slope));
      } else if (theme === 'alpine') {
        const pine = mixRgb([44, 78, 42], [84, 118, 56], canopyNoise);
        const rock = mixRgb(pine, [78, 82, 82], smoothstep(0.36, 0.92, slope + eC * 0.3));
        const snowThresh = 0.62 - slope * 0.14 + (microNoise - 0.5) * 0.12;
        baseCol = mixRgb(rock, [236, 240, 244], smoothstep(snowThresh, snowThresh + 0.12, eC));
      } else if (theme === 'japan') {
        const forest = mixRgb([42, 84, 46], [96, 134, 62], canopyNoise);
        const rock = mixRgb(forest, [76, 80, 74], smoothstep(0.44, 1.0, slope));
        // Smooth radial Mount Fuji SW snow cone (no hard circle step)
        const fujiD = Math.hypot((nx - 0.14) * 1.1, ny - 0.84);
        const fujiMask = smoothstep(0.26, 0.05, fujiD);
        const snowLine = 0.78 - fujiMask * 0.36 + (microNoise - 0.5) * 0.10;
        baseCol = mixRgb(rock, [238, 241, 244], smoothstep(snowLine, snowLine + 0.12, eC + fujiMask * 0.25));
      } else if (theme === 'canada') {
        const fallTone = smoothstep(0.45, 0.75, fbm(nx * 14, ny * 14, seed + 251, 3));
        const maple = mixRgb([64, 108, 44], [186, 92, 34], fallTone * 0.75);
        baseCol = mixRgb(maple, [86, 84, 72], smoothstep(0.48, 1.0, slope));
      } else {
        // Temperate / Flanders / Swiss / California / Australia
        const fieldTilt = theme === 'flanders'
          ? (fbm(nx * 18 + ny * 6, ny * 18 - nx * 6, seed + 511, 2) - 0.5) * 0.24
          : 0;
        const meadow = theme === 'california' ? [168, 152, 88] : [132, 160, 74];
        const woods = theme === 'california' ? [68, 96, 48] : [60, 92, 42];
        let col = mixRgb(meadow, woods, smoothstep(0.35, 0.72, canopyNoise) + fieldTilt);
        col = mixRgb(col, [82, 82, 68], smoothstep(0.46, 1.05, slope));
        if (theme === 'swiss') {
          const snowCut = 0.80 - (microNoise - 0.5) * 0.10;
          col = mixRgb(col, [234, 238, 242], smoothstep(snowCut, snowCut + 0.12, eC));
        }
        baseCol = col;
      }

      // Forest zone canopy enrichment
      for (let f = 0; f < forestCenters.length; f++) {
        const fc = forestCenters[f];
        const dist = Math.hypot(x - fc.cx, y - fc.cy);
        if (dist < fc.r) {
          const k = (1 - dist / fc.r) * smoothstep(0.28, 0.72, canopyNoise);
          const fCol = fc.tint ?? [42, 78, 34];
          baseCol = mixRgb(baseCol, fCol, k * 0.75);
        }
      }

      // Urban subtle town pads & irregular building footprints
      for (let u = 0; u < urbanCenters.length; u++) {
        const uc = urbanCenters[u];
        const dist = Math.hypot(x - uc.cx, y - uc.cy);
        if (dist < uc.r) {
          const patchNoise = fbm(nx * 24, ny * 24, seed + 311 + u * 17, 2);
          const bx = Math.floor(x / 7);
          const by = Math.floor(y / 7);
          const isRoof = ihash(bx, by, seed + 409) > 0.62 && (x % 7) > 1 && (y % 7) > 1;
          const k = smoothstep(uc.r, uc.r * 0.25, dist) * smoothstep(0.32, 0.68, patchNoise);
          baseCol = mixRgb(baseCol, isRoof ? [162, 158, 150] : [102, 104, 98], k * 0.65);
        }
      }

      // Sandy / rocky coastal beach rim
      if (coastProfile || guideBuf) {
        const dl = dLand[i];
        if (dl < 5.5) {
          const beachMix = smoothstep(5.5, 0.5, dl) * smoothstep(0.75, 0.25, slope);
          const beachCol = theme === 'desert' ? [228, 206, 162] : [188, 174, 132];
          baseCol = mixRgb(baseCol, beachCol, beachMix * 0.72);
        }
      }

      // Apply NW directional lighting + cast mountain shadow + ambient occlusion
      const light = clamp(0.36 + 0.72 * ndotl * shadow, 0.24, 1.12) * ao;
      let lit = [
        baseCol[0] * light + (ndotl * shadow > 0.68 ? 10 : 0),
        baseCol[1] * light + (ndotl * shadow > 0.68 ? 8 : 0),
        baseCol[2] * light,
      ];

      // Subtle crisp terrain-integrated road network (matches mywhooshinfo grey/tan roads)
      const dR = dRoadMain[i];
      if (dR < 3.4) {
        const shoulder = smoothstep(3.4, 2.1, dR);
        const core = smoothstep(2.1, 1.0, dR);
        const roadFill = theme === 'desert' || theme === 'canyon' ? [168, 156, 138] : [144, 142, 136];
        lit = mixRgb(lit, [54, 58, 56], shoulder * 0.65);
        lit = mixRgb(lit, roadFill, core * 0.92);
      } else if (dRoadDashed && dRoadDashed[i] < 2.6) {
        const dashOn = ((x + y) % 16) < 9;
        if (dashOn) {
          const core = smoothstep(2.6, 1.0, dRoadDashed[i]);
          lit = mixRgb(lit, [118, 186, 204], core * 0.78);
        }
      }

      rgba[p4] = Math.round(clamp(lit[0], 0, 255));
      rgba[p4 + 1] = Math.round(clamp(lit[1], 0, 255));
      rgba[p4 + 2] = Math.round(clamp(lit[2], 0, 255));
      rgba[p4 + 3] = 255;
    }
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${id}.webp`);
  await sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
    .webp({ quality: 90, effort: 4 })
    .toFile(outPath);

  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`Generated ${id}.webp (${W}x${H}, ${kb}KB)`);
  return { width: W, height: H };
}

const extra = JSON.parse(fs.readFileSync(EXTRA_TRACKS_PATH, 'utf8'));

const GPX_WORLD_CONFIGS = [
  {
    id: 'alula',
    gpx: 'Alula.gpx',
    theme: 'canyon',
    seed: 11,
    forestZones: [
      { lat: 26.610, lon: 37.743, rFrac: 0.06, tint: [58, 114, 48] },
      { lat: 26.562, lon: 37.758, rFrac: 0.05, tint: [64, 118, 52] },
    ],
    urbanZones: [
      { lat: 26.582, lon: 37.733, rFrac: 0.045 },
      { lat: 26.639, lon: 37.796, rFrac: 0.04 },
    ],
    landmarks: [
      { name: 'Heritage Climb Summit', lat: 26.60838, lon: 37.76093, eleM: 333 },
      { name: 'Elephant Rock', lat: 26.59548, lon: 37.75664 },
      { name: 'Hegra', lat: 26.56892, lon: 37.74126 },
      { name: 'Nabatean Cave', lat: 26.63882, lon: 37.79069 },
      { name: 'Dome City', lat: 26.58216, lon: 37.73306 },
      { name: 'Desert Trail', lat: 26.62476, lon: 37.7683, eleM: 215 },
    ],
  },
  {
    id: 'arabia',
    gpx: 'Arabia.gpx',
    theme: 'desert',
    seed: 19,
    coastProfile: {
      type: 'westBay',
      shoreX: (ny, W) => W * (ny > 0.62 ? 0.34 : 0.12),
      roadKeepPx: 52,
      jitterPx: 38,
    },
    customWaterPolys: [
      // Organic curved Al Qudra desert oasis lagoon
      [
        [23.366, 52.249], [23.368, 52.246], [23.372, 52.244], [23.375, 52.246],
        [23.377, 52.250], [23.376, 52.254], [23.373, 52.257], [23.369, 52.256], [23.366, 52.253],
      ],
    ],
    forestZones: [
      { lat: 23.371, lon: 52.249, rFrac: 0.045, tint: [62, 118, 52] },
      { lat: 23.441, lon: 52.212, rFrac: 0.04, tint: [66, 122, 54] },
    ],
    urbanZones: [
      { lat: 23.395, lon: 52.180, rFrac: 0.05 },
      { lat: 23.360, lon: 52.203, rFrac: 0.045 },
    ],
    landmarks: [
      { name: 'Jabel Jais', lat: 23.49834, lon: 52.18677, eleM: 925 },
      { name: 'Jabel Hafeet', lat: 23.43505, lon: 52.26749, eleM: 735 },
      { name: 'Tel Moreeb', lat: 23.44638, lon: 52.23434, eleM: 310 },
      { name: 'Yas Marina', lat: 23.39534, lon: 52.18051 },
    ],
  },
  {
    id: 'australia',
    gpx: 'Australia.gpx',
    theme: 'temperate',
    seed: 29,
    coastProfile: {
      type: 'eastSea',
      shoreX: (ny, W) => W * (0.76 - ny * 0.08 + Math.sin(ny * 7) * 0.03),
      roadKeepPx: 54,
      jitterPx: 36,
    },
    riverPaths: [
      [[-21.028, 148.726], [-21.012, 148.738], [-20.998, 148.742], [-20.988, 148.778]],
    ],
    forestZones: [
      { lat: -21.025, lon: 148.732, rFrac: 0.10 },
      { lat: -21.005, lon: 148.746, rFrac: 0.07 },
      { lat: -21.013, lon: 148.763, rFrac: 0.06 },
    ],
    urbanZones: [
      { lat: -20.997, lon: 148.738, rFrac: 0.05 },
      { lat: -20.998, lon: 148.777, rFrac: 0.045 },
    ],
    specialFeatures: [
      { kind: 'bridge', lat: -20.999, lon: 148.734, toLat: -20.997, toLon: 148.739 },
    ],
    landmarks: [
      { name: 'Outerloop Summit', lat: -21.01266, lon: 148.76307, eleM: 404 },
      { name: 'Mount Pleasant', lat: -21.00833, lon: 148.75969, eleM: 164 },
    ],
  },
  {
    id: 'belgium',
    gpx: 'Belgium.gpx',
    theme: 'flanders',
    seed: 37,
    riverPaths: [
      [[50.752, 3.532], [50.778, 3.541], [50.808, 3.553], [50.838, 3.546], [50.865, 3.552]],
    ],
    forestZones: [
      { lat: 50.796, lon: 3.594, rFrac: 0.09 },
      { lat: 50.825, lon: 3.563, rFrac: 0.07 },
      { lat: 50.783, lon: 3.518, rFrac: 0.06 },
      { lat: 50.772, lon: 3.570, rFrac: 0.06 },
    ],
    urbanZones: [
      { lat: 50.842, lon: 3.542, rFrac: 0.05 },
      { lat: 50.810, lon: 3.552, rFrac: 0.045 },
      { lat: 50.760, lon: 3.494, rFrac: 0.045 },
    ],
    landmarks: [
      { name: 'Muur van Geraardsbergen', lat: 50.82568, lon: 3.56314, eleM: 177 },
      { name: 'Koppenberg', lat: 50.78347, lon: 3.51818, eleM: 110 },
      { name: 'Oude Kwaremont', lat: 50.77239, lon: 3.57022, eleM: 94 },
    ],
  },
  {
    id: 'california',
    gpx: 'California.gpx',
    theme: 'california',
    seed: 43,
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 72,
      jitterPx: 30,
      cutout: (nx, ny, dRoad) => {
        if (dRoad <= 24) return 999;
        const bayDist = Math.hypot((nx - 0.28) * 1.05, (ny - 0.80) * 1.35) - 0.17;
        return bayDist < 0 ? bayDist * 260 : 999;
      },
    },
    forestZones: [
      { lat: 38.399, lon: -120.403, rFrac: 0.09, tint: [32, 74, 38] },
      { lat: 38.445, lon: -120.362, rFrac: 0.06 },
    ],
    urbanZones: [
      { lat: 38.393, lon: -120.372, rFrac: 0.05 },
      { lat: 38.447, lon: -120.340, rFrac: 0.048 },
    ],
    specialFeatures: [
      { kind: 'bridge', lat: 38.391, lon: -120.394, toLat: 38.395, toLon: -120.386 },
    ],
    landmarks: [
      { name: 'Hollywood Hills', lat: 38.44508, lon: -120.36226, eleM: 202 },
      { name: 'Mount Umunhum', lat: 38.39085, lon: -120.36856, eleM: 290 },
      { name: 'Onyx Peak', lat: 38.41393, lon: -120.33599, eleM: 210 },
    ],
  },
  {
    id: 'colombia',
    gpx: 'Colombia.gpx',
    theme: 'colombia',
    seed: 53,
    riverPaths: [
      [[4.565, -72.815], [4.595, -72.805], [4.628, -72.792], [4.666, -72.775]],
    ],
    customWaterPolys: [
      [[4.576, -72.797], [4.580, -72.795], [4.584, -72.799], [4.583, -72.804], [4.578, -72.804]],
    ],
    forestZones: [
      { lat: 4.628, lon: -72.770, rFrac: 0.12, tint: [30, 82, 38] },
      { lat: 4.573, lon: -72.806, rFrac: 0.07 },
      { lat: 4.618, lon: -72.845, rFrac: 0.07 },
    ],
    urbanZones: [
      { lat: 4.600, lon: -72.817, rFrac: 0.048 },
      { lat: 4.580, lon: -72.800, rFrac: 0.042 },
    ],
    landmarks: [
      { name: 'Alto Limonar', lat: 4.606, lon: -72.86107, eleM: 1037 },
      { name: 'Cristo Rey', lat: 4.66058, lon: -72.83998, eleM: 1482 },
      { name: 'Paso De Alto', lat: 4.59916, lon: -72.78872, eleM: 889 },
    ],
  },
  {
    id: 'hudayriyat',
    gpx: 'Hudayriyat.gpx',
    theme: 'hudayriyat',
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
        if (ny < 0.45 && nx < 0.56 && dRoad > 24) return -32;
        if (nx > 0.48 && ny > 0.42 && dRoad > 34) return -32;
        return 999;
      },
    },
    dashedTracks: extra['hudayriyat-arcade'].tracks,
    forestZones: [
      { lat: 23.361, lon: 54.978, rFrac: 0.05 },
      { lat: 23.346, lon: 54.974, rFrac: 0.045 },
      { lat: 23.404, lon: 55.034, rFrac: 0.045 },
    ],
    urbanZones: [
      { lat: 23.374, lon: 54.975, rFrac: 0.04 },
      { lat: 23.402, lon: 55.036, rFrac: 0.038 },
    ],
    specialFeatures: [
      { kind: 'bridge', lat: 23.370, lon: 54.974, toLat: 23.376, toLon: 54.975 },
    ],
    landmarks: [
      { name: 'Hudayriyat Summit', lat: 23.35686, lon: 54.97611, eleM: 134 },
    ],
  },
  {
    id: 'japan',
    gpx: 'Japan.gpx',
    theme: 'japan',
    seed: 71,
    coastProfile: {
      type: 'eastSea',
      shoreX: (ny, W) => W * (ny > 0.3 ? 0.72 : 0.80),
      roadKeepPx: 50,
      jitterPx: 32,
    },
    riverPaths: [
      [[35.475, 135.140], [35.455, 135.158], [35.435, 135.174]],
    ],
    forestZones: [
      { lat: 35.448, lon: 135.163, rFrac: 0.07 },
      { lat: 35.426, lon: 135.125, rFrac: 0.085 },
      { lat: 35.471, lon: 135.130, rFrac: 0.05, tint: [195, 108, 146] },
    ],
    urbanZones: [
      { lat: 35.468, lon: 135.140, rFrac: 0.055 },
      { lat: 35.437, lon: 135.166, rFrac: 0.05 },
    ],
    landmarks: [
      { name: 'Mount Fuji', lat: 35.40904, lon: 135.10357, eleM: 1016 },
    ],
  },
  {
    id: 'mywhoosh-world',
    gpx: 'MywhooshWorld.gpx',
    theme: 'fantasy',
    seed: 83,
    coastProfile: {
      type: 'island',
      fillLoops: true,
      bufferPx: 74,
      jitterPx: 32,
    },
    customWaterPolys: [],
    forestZones: [
      { lat: 25.012, lon: -71.003, rFrac: 0.085, tint: [28, 118, 76] },
      { lat: 24.991, lon: -71.013, rFrac: 0.055 },
    ],
    urbanZones: [
      { lat: 24.995, lon: -71.006, rFrac: 0.055 },
      { lat: 25.001, lon: -71.014, rFrac: 0.045 },
    ],
    landmarks: [
      { name: 'Snowfall Mountain', lat: 24.9716, lon: -71.03076, eleM: 655 },
      { name: 'Blaze Summit', lat: 25.00776, lon: -70.98016, eleM: 235 },
    ],
  },
];

const EXTRA_WORLD_CONFIGS = [
  {
    id: 'switzerland',
    theme: 'swiss',
    seed: 97,
    elevationRange: [400, 920],
    bounds: [
      [47.314, 8.492],
      [47.405, 8.618],
    ],
    tracks: extra.switzerland.tracks,
    customWaterPolys: [
      // Organic curved Lake Zurich bay situated cleanly in the SE basin clear of road loops
      [
        [47.314, 8.584], [47.326, 8.584], [47.338, 8.581], [47.347, 8.575], [47.349, 8.582],
        [47.344, 8.591], [47.334, 8.598], [47.324, 8.606], [47.314, 8.612],
      ],
    ],
    riverPaths: [
      [[47.347, 8.579], [47.358, 8.567], [47.368, 8.552], [47.381, 8.537], [47.394, 8.524], [47.404, 8.515]],
    ],
    forestZones: [
      { lat: 47.394, lon: 8.560, rFrac: 0.095 },
      { lat: 47.378, lon: 8.572, rFrac: 0.08 },
      { lat: 47.344, lon: 8.512, rFrac: 0.09 },
    ],
    urbanZones: [
      { lat: 47.372, lon: 8.540, rFrac: 0.065 },
      { lat: 47.390, lon: 8.526, rFrac: 0.045 },
    ],
    landmarks: [
      { name: 'Zürichbergstrasse', lat: 47.39444, lon: 8.52905, eleM: 466 },
    ],
  },
  {
    id: 'france',
    theme: 'temperate',
    seed: 103,
    elevationRange: [150, 1930],
    bounds: [
      [47.24881, 3.85573],
      [47.35581, 4.00736],
    ],
    mapRotationDeg: 90,
    fixedSize: [1230, 1182],
    franceGuidePath: FRANCE_GUIDE_PATH,
    tracks: extra.france.tracks,
    forestZones: [
      { nx: 0.56, ny: 0.34, rFrac: 0.11 },
      { nx: 0.80, ny: 0.18, rFrac: 0.10 },
      { nx: 0.18, ny: 0.72, rFrac: 0.12 },
    ],
    urbanZones: [
      { nx: 0.50, ny: 0.38, rFrac: 0.045 },
      { nx: 0.34, ny: 0.05, rFrac: 0.032 },
    ],
    landmarks: [
      { name: 'Mission Stage 2', lat: 47.301, lon: 3.895, eleM: 168 },
    ],
  },
  {
    id: 'bhutan',
    theme: 'alpine',
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
      { nx: 0.35, ny: 0.62, rFrac: 0.10 },
      { nx: 0.68, ny: 0.50, rFrac: 0.09 },
    ],
    urbanZones: [{ nx: 0.24, ny: 0.72, rFrac: 0.05 }],
    landmarks: [
      { name: 'Dragon Rae Climb', nx: 0.56, ny: 0.25, eleM: 370 },
      { name: 'Pele La Pass', nx: 0.78, ny: 0.34, eleM: 300 },
    ],
  },
  {
    id: 'canada',
    theme: 'canada',
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
      shoreX: (ny, W) => W * (0.85 - ny * 0.06),
      roadKeepPx: 50,
      jitterPx: 30,
    },
    forestZones: [
      { nx: 0.54, ny: 0.46, rFrac: 0.14, tint: [158, 72, 28] },
      { nx: 0.32, ny: 0.56, rFrac: 0.09 },
    ],
    urbanZones: [
      { nx: 0.74, ny: 0.65, rFrac: 0.06 },
      { nx: 0.24, ny: 0.68, rFrac: 0.05 },
    ],
    landmarks: [
      { name: 'Camillien Houde', nx: 0.58, ny: 0.24, eleM: 247 },
    ],
  },
  {
    id: 'endurance-climb',
    theme: 'alpine',
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
      { nx: 0.22, ny: 0.70, rFrac: 0.10 },
      { nx: 0.52, ny: 0.55, rFrac: 0.09 },
    ],
    landmarks: [
      { name: 'Cima Section 9/9', nx: 0.80, ny: 0.18, eleM: 2642 },
      { name: 'Campamento Medio', nx: 0.44, ny: 0.46, eleM: 1280 },
    ],
  },
  {
    id: 'supertri',
    theme: 'hudayriyat',
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
    urbanZones: [{ nx: 0.48, ny: 0.50, rFrac: 0.07 }],
    forestZones: [{ nx: 0.66, ny: 0.44, rFrac: 0.06 }],
    landmarks: [{ name: 'Supertri E Lap', nx: 0.54, ny: 0.30, eleM: 20 }],
  },
  {
    id: 'uci-2024',
    theme: 'swiss',
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
    forestZones: [{ nx: 0.54, ny: 0.48, rFrac: 0.09 }],
    urbanZones: [{ nx: 0.34, ny: 0.64, rFrac: 0.06 }],
    landmarks: [{ name: 'Stage 2 Climb', nx: 0.38, ny: 0.28, eleM: 203 }],
  },
  {
    id: 'uci-2025',
    theme: 'colombia',
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
    forestZones: [{ nx: 0.54, ny: 0.44, rFrac: 0.10 }],
    urbanZones: [{ nx: 0.28, ny: 0.64, rFrac: 0.055 }],
    landmarks: [{ name: "The Mountain's Verdict", nx: 0.78, ny: 0.28, eleM: 751 }],
  },
  {
    id: 'uci-2026',
    theme: 'hudayriyat',
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
      { nx: 0.36, ny: 0.46, rFrac: 0.06 },
      { nx: 0.70, ny: 0.50, rFrac: 0.055 },
    ],
    forestZones: [{ nx: 0.52, ny: 0.62, rFrac: 0.07 }],
    landmarks: [{ name: 'Pearl District', nx: 0.34, ny: 0.28, eleM: 98 }],
  },
  {
    id: 'bled',
    theme: 'swiss',
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
      { nx: 0.16, ny: 0.28, rFrac: 0.10 },
      { nx: 0.84, ny: 0.26, rFrac: 0.10 },
      { nx: 0.20, ny: 0.82, rFrac: 0.09 },
    ],
    urbanZones: [{ nx: 0.80, ny: 0.68, rFrac: 0.05 }],
    syntheticCircuits: [[[0.22, 0.54], [0.80, 0.50]]],
    landmarks: [{ name: 'Isla de Bled', nx: 0.48, ny: 0.52 }],
  },
];

const INF_DIST = 1e6;

async function main() {
  // Clean obsolete SVG files before writing fresh WebPs
  if (fs.existsSync(OUT_DIR)) {
    for (const f of fs.readdirSync(OUT_DIR)) {
      if (f.endsWith('.svg')) fs.unlinkSync(path.join(OUT_DIR, f));
    }
  }

  const roadsData = { worlds: {} };

  for (const cfg of GPX_WORLD_CONFIGS) {
    const gpxTracks = parseGpxFile(path.join(GPX_DIR, cfg.gpx));
    const allPts = gpxTracks.flatMap((t) => t.pts);
    const bounds = cfg.fixedBounds ?? padBounds(allPts, 0.085);
    const { width, height } = await renderWorldMapWebp({
      ...cfg,
      bounds,
      tracks: gpxTracks.map((t) => t.pts),
    });

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
  }

  for (const cfg of EXTRA_WORLD_CONFIGS) {
    const { width, height } = await renderWorldMapWebp(cfg);
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
  }

  fs.writeFileSync(OUT_DATA_PATH, JSON.stringify(roadsData));
  console.log(`Saved ${OUT_DATA_PATH}: ${(fs.statSync(OUT_DATA_PATH).size / 1024).toFixed(1)}KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
