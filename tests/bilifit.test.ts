import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import sharp from 'sharp';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';

// Usar una DB temporal aislada durante los tests
const tmpDb = path.join(os.tmpdir(), `bilifit-test-${Date.now()}.db`);
process.env.BILIFIT_DB_PATH = tmpDb;
process.env.BILIFIT_SECRET = 'bilifit-test-secret';
process.env.BILIFIT_DISABLE_SCHEDULER = '1';

import {
  calculateCyclingTSS,
  calculateNormalizedPower,
  calculatePMC,
  computePowerCurve,
} from '../src/lib/metrics';
import { decodePolyline, encodePolyline } from '../src/lib/polyline';
import { parseGpxString, generateGpxString } from '../src/lib/parsers/gpx';
import { parseTcxString } from '../src/lib/parsers/tcx';
import { parseUploadedActivityBatch, parseUploadedActivityFile } from '../src/lib/parsers';
import {
  applyHealthSyncMetadata,
  groupHealthSyncFiles,
  parseHealthSyncCsv,
  parseHuaweiMotionPathJson,
  parseHiTrackText,
} from '../src/lib/parsers/huawei';
import {
  disconnectGoogleDrive,
  exchangeGoogleDriveCode,
  getGoogleDriveAuthUrl,
  getHuaweiStatus,
  syncHuaweiActivities,
  updateHuaweiPreferences,
} from '../src/lib/huawei-sync';
import {
  DEFAULT_EXERCISES,
  generateHomeRoutine,
  getAlternativeExercises,
  isExerciseCompatible,
} from '../src/lib/home-workouts';
import {
  backfillMyWhooshWorlds,
  createActivity,
  createCustomEquipment,
  createSegmentAndMatch,
  getActivityById,
  getAthleteProfile,
  getDb,
  getSegmentWithEfforts,
  listActivities,
  listHomeEquipment,
  listSegments,
  toggleHomeEquipment,
} from '../src/lib/db';
import {
  calculateMinettiGapFactor,
  computeBestEfforts,
  computeHeartRateZones,
  computeKmSplits,
  computePaceZones,
  computeSessionExtras,
  computeTerrainBreakdown,
  enrichPointsTelemetry,
} from '../src/lib/analytics';
import {
  alignCoordsToMyWhooshWorld,
  getMyWhooshWorldByIdOrName,
  getWorldDisplayBounds,
  MYWHOOSH_WORLDS,
  matchGpsToWorldRoads,
  resolveMyWhooshWorldForActivity,
  toWorldDisplayCoord,
  toWorldDisplayCoords,
} from '../src/lib/mywhoosh-maps';
import roadsDataset from '../src/lib/mywhoosh-roads-data.json';
import {
  connectMyWhooshAccount,
  decodeJwtExpiry,
  decryptSecret,
  disconnectMyWhoosh,
  encryptSecret,
  extractMyWhooshActivityBuffer,
  getMyWhooshStatus,
  parseMyWhooshActivityPage,
  syncMyWhooshActivities,
  updateMyWhooshSyncPreferences,
  validateMyWhooshDownloadUrl,
  type FetchLike,
} from '../src/lib/mywhoosh-sync';
import { buildSegmentFromRange, detectClimbCandidates, matchPointsToSegment } from '../src/lib/segments';
import { mapStravaSport } from '../src/lib/strava';

test.after(() => {
  for (const suffix of ['', '-wal', '-shm']) {
    const f = `${tmpDb}${suffix}`;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});

test('Polyline encode/decode roundtrip preserves coordinates', () => {
  const input: Array<[number, number]> = [
    [43.3619, -5.8494],
    [43.3721, -5.8612],
    [43.385, -5.868],
  ];
  const encoded = encodePolyline(input);
  const decoded = decodePolyline(encoded);
  assert.equal(decoded.length, input.length);
  for (let i = 0; i < input.length; i++) {
    assert.ok(Math.abs(decoded[i][0] - input[i][0]) < 0.0001);
    assert.ok(Math.abs(decoded[i][1] - input[i][1]) < 0.0001);
  }
});

test('GPX parser extracts MyWhoosh power, cadence, heart rate and detects sport', () => {
  const myWhooshGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MyWhoosh 5.3" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk>
    <name>Hudayriyat Tempo Ride</name>
    <type>VirtualRide</type>
    <trkseg>
      ${Array.from({ length: 20 })
        .map((_, i) => {
          const ts = new Date(Date.UTC(2026, 10, 1, 18, 0, i * 10)).toISOString();
          const watts = 220 + (i % 4) * 15;
          const hr = 148 + i;
          const cad = 88 + (i % 3);
          return `<trkpt lat="24.41${10 + i}" lon="54.34${10 + i}"><ele>${10 + i * 0.5}</ele><time>${ts}</time><extensions><power>${watts}</power><gpxtpx:TrackPointExtension><gpxtpx:hr>${hr}</gpxtpx:hr><gpxtpx:cad>${cad}</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>`;
        })
        .join('\n')}
    </trkseg>
  </trk>
</gpx>`;

  const parsed = parseGpxString(myWhooshGpx, 'hudayriyat.gpx');
  assert.equal(parsed.sport, 'mywhoosh');
  assert.equal(parsed.worldName, 'Hudayriyat');
  assert.ok(parsed.avgWatts && parsed.avgWatts >= 230);
  assert.ok(parsed.normalizedPower && parsed.normalizedPower >= 230);
  assert.ok(parsed.avgHr && parsed.avgHr >= 150);
  assert.ok(parsed.avgCadence && parsed.avgCadence >= 85);
  assert.equal(parsed.points.length, 20);

  // Roundtrip export GPX
  const exported = generateGpxString('Test Export', parsed.points, 'hiking');
  assert.ok(exported.includes('<trkpt'));
});

test('TCX parser extracts mountain trail activity and elevation', () => {
  const tcx = `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Activities>
    <Activity Sport="Hiking">
      <Id>2026-10-15T08:00:00Z</Id>
      <Notes>Subida Picu Pienzu</Notes>
      <Lap StartTime="2026-10-15T08:00:00Z">
        <TotalTimeSeconds>3600</TotalTimeSeconds>
        <DistanceMeters>9500</DistanceMeters>
        <Calories>620</Calories>
        <Track>
          <Trackpoint>
            <Time>2026-10-15T08:00:00Z</Time>
            <Position><LatitudeDegrees>43.462</LatitudeDegrees><LongitudeDegrees>-5.228</LongitudeDegrees></Position>
            <AltitudeMeters>600</AltitudeMeters>
            <DistanceMeters>0</DistanceMeters>
            <HeartRateBpm><Value>132</Value></HeartRateBpm>
          </Trackpoint>
          <Trackpoint>
            <Time>2026-10-15T08:30:00Z</Time>
            <Position><LatitudeDegrees>43.469</LatitudeDegrees><LongitudeDegrees>-5.234</LongitudeDegrees></Position>
            <AltitudeMeters>1150</AltitudeMeters>
            <DistanceMeters>4800</DistanceMeters>
            <HeartRateBpm><Value>156</Value></HeartRateBpm>
          </Trackpoint>
        </Track>
      </Lap>
    </Activity>
  </Activities>
</TrainingCenterDatabase>`;

  const parsed = parseTcxString(tcx, 'pienzu.tcx');
  assert.equal(parsed.sport, 'mountain');
  assert.equal(parsed.distanceMeters, 4800);
  assert.equal(parsed.elevationGain, 550);
  assert.equal(parsed.avgHr, 144);
});

test('FIT binary parser decodes encoded FIT buffer and ZIP importer extracts multiple files', async () => {
  const encoder = new FitEncoder();
  const baseDate = new Date('2026-10-20T09:00:00Z');
  const fitTs = FitEncoder.toFitTimestamp(baseDate);
  const degToSemicircles = (deg: number) => Math.round((deg * 2147483648) / 180);

  // file_id (msg 0)
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
  ], 0);

  // session (msg 18) -> running (1), trail (3)
  encoder.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 1800 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
    { number: 6, size: 1, baseType: FitBaseType.Enum, value: 3 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 1800 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 1800 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 6200 * 100 },
    { number: 22, size: 2, baseType: FitBaseType.Uint16, value: 240 },
    { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 154 },
  ], 1);

  // records (msg 20)
  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemicircles(43.385) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemicircles(-5.868) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (220 + 500) * 5 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 145 },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 0 },
  ], 2);

  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 900 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemicircles(43.391) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemicircles(-5.875) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (460 + 500) * 5 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 163 },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 3100 * 100 },
  ], 2);

  const fitBytes = encoder.close();
  const fitBuf = Buffer.from(fitBytes.buffer, fitBytes.byteOffset, fitBytes.byteLength);

  const zip = new JSZip();
  zip.file('activities/trail_naranco.fit', fitBuf);
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });

  const imported = await parseUploadedActivityFile('strava_export.zip', zipBuf);
  assert.equal(imported.errors.length, 0);
  assert.equal(imported.activities.length, 1);
  assert.equal(imported.activities[0].sport, 'mountain');
  assert.equal(imported.activities[0].distanceMeters, 6200);
  assert.equal(imported.activities[0].elevationGain, 240);
});

test('Metrics engine calculates NP, TSS, power curve and PMC accurately', () => {
  const points = Array.from({ length: 120 }, (_, i) => ({
    t: i * 15,
    watts: i % 2 === 0 ? 260 : 220,
    hr: 152,
  }));
  const np = calculateNormalizedPower(points);
  assert.ok(np && np >= 235 && np <= 255);
  const tss = calculateCyclingTSS(3600, 245, 245);
  assert.equal(tss, 100);

  const curve = computePowerCurve(points);
  assert.ok(curve.some((c) => c.label === '5m' && c.watts >= 230));

  const pmc = calculatePMC([], 30);
  assert.equal(pmc.length, 30);
});

test('Home workout generator strictly respects selected equipment and offers compatible swaps', () => {
  // Caso 1: solo esterilla y bandas (sin mancuernas ni barra)
  const minimalEq = ['mat', 'bands'];
  const planMinimal = generateHomeRoutine({
    goal: 'correr_montana',
    level: 'intermedio',
    durationMin: 30,
    availableEquipmentIds: minimalEq,
    variationSeed: 3,
  });

  assert.equal(planMinimal.items.length, 5);
  const eqSet = new Set(minimalEq);
  for (const item of planMinimal.items) {
    const ex = DEFAULT_EXERCISES.find((e) => e.id === item.exerciseId);
    assert.ok(ex, `Exercise ${item.exerciseId} should exist`);
    assert.ok(
      isExerciseCompatible(ex, eqSet),
      `Exercise ${ex.name} requires [${ex.requiredEquipment.join(',')}] which is not in [${minimalEq.join(',')}]`
    );
  }

  // Caso 2: sin ningún material (solo peso corporal)
  const bwPlan = generateHomeRoutine({
    goal: 'fuerza_general',
    level: 'principiante',
    durationMin: 20,
    availableEquipmentIds: [],
    variationSeed: 1,
  });
  assert.equal(bwPlan.items.length, 4);
  for (const item of bwPlan.items) {
    assert.equal(item.requiredEquipment.length, 0);
  }

  // Caso 3: alternativas compatibles para intercambiar
  const alts = getAlternativeExercises(
    planMinimal.items[0].exerciseId,
    minimalEq,
    planMinimal.items.map((i) => i.exerciseId)
  );
  assert.ok(alts.length > 0);
  for (const alt of alts) {
    assert.ok(isExerciseCompatible(alt, eqSet));
  }
});

test('SQLite DB initializes seed data, toggles equipment, and persists activities', () => {
  const profile = getAthleteProfile();
  assert.ok(profile.ftpWatts > 100);

  const activities = listActivities();
  assert.ok(activities.length >= 10);

  const equipment = listHomeEquipment();
  assert.ok(equipment.length >= 10);

  const kettlebell = equipment.find((e) => e.id === 'kettlebell')!;
  const toggled = toggleHomeEquipment(kettlebell.id, !kettlebell.owned);
  assert.equal(toggled?.owned, !kettlebell.owned);

  const customEq = createCustomEquipment({
    id: 'eq_test_vest',
    name: 'Chaleco lastrado 10kg',
    category: 'peso_libre',
    description: 'Para dominadas y zancadas',
    owned: true,
    details: '10 kg',
  });
  assert.equal(customEq.name, 'Chaleco lastrado 10kg');

  const created = createActivity({
    id: 'act_test_1',
    externalId: null,
    source: 'manual',
    sport: 'mywhoosh',
    subSport: 'MyWhoosh Indoor',
    title: 'Test MyWhoosh Session',
    description: 'Prueba unitaria',
    startedAt: new Date().toISOString(),
    durationSec: 2400,
    movingTimeSec: 2400,
    distanceMeters: 26000,
    elevationGain: 180,
    elevationLoss: 180,
    avgSpeedMs: 10.8,
    maxSpeedMs: 14,
    avgHr: 150,
    maxHr: 170,
    avgWatts: 225,
    normalizedPower: 235,
    maxWatts: 340,
    avgCadence: 90,
    calories: 500,
    tss: 62,
    rpe: 7,
    gearId: null,
    worldName: 'Belgium',
    polyline: null,
    startLat: null,
    startLon: null,
    points: [],
    strengthLogs: [],
    totalVolumeKg: null,
    createdAt: new Date().toISOString(),
  });
  assert.equal(created.worldName, 'Belgium');

  // Strava mapper check
  assert.equal(mapStravaSport('VirtualRide', 'VirtualRide', 'MyWhoosh Arabia').sport, 'mywhoosh');
  assert.equal(mapStravaSport('Run', 'TrailRun', 'Trail Picos').sport, 'mountain');
});

test('MyWhoosh virtual worlds resolve, align (including Free Rides), avoid outdoor false positives, and backfill safely', async () => {
  assert.equal(MYWHOOSH_WORLDS.length, 19);

  const mercatorY = (lat: number) => {
    const rad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  };

  // 1. Verificar los 19 mapas WebP 3D en disco, cabecera WebP válida, dimensiones y relación de aspecto Mercator acorde a bounds visibles
  for (const w of MYWHOOSH_WORLDS) {
    assert.ok(w.imageUrl.endsWith('.webp'), `Expected .webp asset for ${w.id}, got ${w.imageUrl}`);
    const rel = w.imageUrl.replace(/^\//, '');
    const full = path.join(process.cwd(), 'public', rel);
    assert.ok(fs.existsSync(full), `Missing MyWhoosh WebP map file: ${full}`);
    const rawHead = fs.readFileSync(full);
    assert.equal(rawHead.subarray(0, 4).toString('ascii'), 'RIFF', `Invalid RIFF header for ${w.id}.webp`);
    assert.equal(rawHead.subarray(8, 12).toString('ascii'), 'WEBP', `Invalid WEBP signature for ${w.id}.webp`);

    const meta = await sharp(full).metadata();
    assert.ok(meta.width && meta.height && meta.width >= 1000 && meta.height >= 700, `Unexpected size for ${w.id}.webp`);
    assert.deepEqual([meta.width, meta.height], w.svgSize, `Size mismatch between ${w.id}.webp and mywhoosh-roads-data.json`);

    const [[s, west], [n, east]] = getWorldDisplayBounds(w);
    const expectedRatio = ((east - west) * (Math.PI / 180)) / (mercatorY(n) - mercatorY(s));
    const actualRatio = meta.width / meta.height;
    assert.ok(
      Math.abs(actualRatio - expectedRatio) < 0.006,
      `Mercator aspect ratio mismatch for ${w.id}: webp=${actualRatio.toFixed(3)} vs displayBounds=${expectedRatio.toFixed(3)}`
    );
    for (const lm of w.landmarks) {
      const [dl, dlo] = toWorldDisplayCoord(w, lm.lat, lm.lon);
      assert.ok(
        dl >= s && dl <= n && dlo >= west && dlo <= east,
        `Landmark ${w.id}/${lm.name} out of displayBounds`
      );
    }
  }

  // Verificar asignaciones oficiales Grupo A (rotación 90° CW), Grupo B (sin rotación) y corrección swap UCI 2024/2025
  for (const id of [
    'hudayriyat', 'alula', 'arabia', 'belgium', 'colombia',
    'australia', 'california', 'japan', 'mywhoosh-world', 'switzerland', 'france',
  ]) {
    assert.equal(getMyWhooshWorldByIdOrName(id)?.mapRotationDeg, 90, `Group A ${id} must use 90° display rotation`);
  }
  for (const id of ['bhutan', 'canada', 'endurance-climb', 'supertri', 'uci-2024', 'uci-2025', 'uci-2026', 'bled']) {
    assert.equal(getMyWhooshWorldByIdOrName(id)?.mapRotationDeg ?? 0, 0, `Group B/schematic ${id} must stay 0°`);
  }
  const uci24 = getMyWhooshWorldByIdOrName('uci-2024')!;
  const uci25 = getMyWhooshWorldByIdOrName('uci-2025')!;
  assert.equal(uci24.mywhooshInfoId, 15);
  assert.equal(uci24.maxElevationM, 203);
  assert.equal(uci25.mywhooshInfoId, 8);
  assert.equal(uci25.maxElevationM, 751);

  // Verificar calibración real y rotación 90° CW de Switzerland (5000x4974 + red viaria vectorizada + snap in-bounds)
  const swiWorld = getMyWhooshWorldByIdOrName('switzerland')!;
  assert.equal(swiWorld.mapRotationDeg, 90);
  assert.deepEqual(swiWorld.svgSize, [5000, 4974]);
  const swiNet = (roadsDataset.worlds as unknown as Record<string, { tracks?: Array<Array<[number, number]>> }>).switzerland;
  assert.ok((swiNet.tracks?.length ?? 0) >= 50, 'Switzerland should carry full vectorized road network');
  const swiBaseTrack = swiNet.tracks![0];
  assert.equal(alignCoordsToMyWhooshWorld(swiWorld, swiBaseTrack).mode, 'native');
  const swiShifted = swiBaseTrack.map(([la, lo]): [number, number] => [la + 0.012, lo + 0.015]);
  const swiLocked = alignCoordsToMyWhooshWorld(swiWorld, swiShifted);
  assert.equal(swiLocked.mode, 'rigid-road-lock');
  assert.ok((swiLocked.rmsErrorM ?? 99) < 8, `Expected crisp Switzerland rigid lock, got RMS ${swiLocked.rmsErrorM}`);

  // Verificar rotación cartográfica 90° CW de France para coincidir con mywhooshinfo.com
  const franceWorld = getMyWhooshWorldByIdOrName('france')!;
  assert.equal(franceWorld.mapRotationDeg, 90);
  const franceDispBounds = getWorldDisplayBounds(franceWorld);
  const [fDispLat, fDispLon] = toWorldDisplayCoord(franceWorld, 47.301, 3.895);
  assert.ok(
    fDispLat >= franceDispBounds[0][0] &&
      fDispLat <= franceDispBounds[1][0] &&
      fDispLon >= franceDispBounds[0][1] &&
      fDispLon <= franceDispBounds[1][1],
    'Transformed France display coord must stay inside rotated displayBounds'
  );
  const franceRotSample = toWorldDisplayCoords(franceWorld, [
    [47.2835, 3.8723],
    [47.3158, 3.9153],
  ]);
  assert.equal(franceRotSample.length, 2);

  // Verificar que ActivityMap usa rotación conformal, overlay en tilePane e inicialización segura
  const activityMapSrc = fs.readFileSync(path.join(process.cwd(), 'src/components/ActivityMap.tsx'), 'utf8');
  assert.ok(activityMapSrc.includes('mapReadyTick'), 'ActivityMap should trigger layer setup once Leaflet finishes async import');
  assert.ok(activityMapSrc.includes('center: initialCenter'), 'ActivityMap should initialize L.map with center/zoom before fitBounds/imageOverlay');
  assert.ok(activityMapSrc.includes("pane: 'tilePane'"), 'ActivityMap should mount virtual WebP overlay inside tilePane under route polylines');
  assert.ok(activityMapSrc.includes('getWorldDisplayBounds'), 'ActivityMap should project virtual map bounds with conformal rotation support');
  assert.ok(activityMapSrc.includes('toWorldDisplayCoords'), 'ActivityMap should rotate GPS polylines consistently with world display rotation');

  // 2. Detección por coordenadas dentro del bounding box de Colombia (con contexto virtual sí; sin contexto virtual no)
  const colMatch = resolveMyWhooshWorldForActivity({
    coords: [
      [4.605, -72.825],
      [4.622, -72.801],
    ],
    sport: 'mywhoosh',
    title: 'Entreno matinal sin nombre de mundo',
  });
  assert.equal(colMatch?.world.id, 'colombia');
  assert.equal(
    resolveMyWhooshWorldForActivity({
      coords: [
        [4.605, -72.825],
        [4.622, -72.801],
      ],
      sport: 'cycling',
      title: 'Entreno real por Colombia',
    }),
    null
  );

  // 3. Detección por nombre de ruta/título cuando existe contexto virtual
  const arabiaMatch = resolveMyWhooshWorldForActivity({
    title: 'Subida dura a Jebel Jais',
    sport: 'mywhoosh',
  });
  assert.equal(arabiaMatch?.world.id, 'arabia');

  // 4. Protección anti-falsos-positivos en salidas reales exteriores (Zúrich y Oviedo)
  assert.equal(
    resolveMyWhooshWorldForActivity({
      title: 'Morning Commute Zurich',
      sport: 'cycling',
      subSport: 'road',
      deviceName: 'Garmin Edge 540',
      coords: [
        [47.3769, 8.5417],
        [47.3785, 8.5442],
      ],
    }),
    null
  );
  assert.equal(
    resolveMyWhooshWorldForActivity({
      title: 'Salida carretera Oviedo - Naranco',
      sport: 'cycling',
      coords: [
        [43.3619, -5.8494],
        [43.385, -5.868],
      ],
    }),
    null
  );

  // GPX real de exterior en Zúrich sin marca virtual no debe clasificarse como MyWhoosh
  const outdoorZurichGpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Garmin Connect" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Morning Commute Zurich</name><type>Cycling</type><trkseg>
    <trkpt lat="47.3769" lon="8.5417"><ele>408</ele><time>2026-10-12T07:00:00Z</time></trkpt>
    <trkpt lat="47.3792" lon="8.5448"><ele>416</ele><time>2026-10-12T07:04:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;
  const parsedOutdoor = parseGpxString(outdoorZurichGpx, 'morning_commute_zurich.gpx');
  assert.equal(parsedOutdoor.sport, 'cycling');
  assert.equal(parsedOutdoor.worldName ?? null, null);

  // 5. Alineación: modo native, datum offset rigid-road-lock, Free Ride parcial y centered
  const alulaWorld = getMyWhooshWorldByIdOrName('alula')!;
  const alulaNetwork = (roadsDataset.worlds as unknown as Record<string, { tracks?: Array<Array<[number, number]>> }>).alula;
  const baseTrack: Array<[number, number]> = [];
  for (const seg of (alulaNetwork.tracks ?? []).slice(0, 6)) {
    for (const pt of seg) {
      baseTrack.push([pt[0], pt[1]]);
    }
  }
  assert.ok(baseTrack.length >= 25, 'AlUla road dataset should have sample coordinates');

  // 5a. Native (sin offset)
  const nativeAligned = alignCoordsToMyWhooshWorld(alulaWorld, baseTrack);
  assert.equal(nativeAligned.mode, 'native');
  assert.equal(nativeAligned.alignedCoords.length, baseTrack.length);

  // 5b. Datum offset completo -> rigid-road-lock
  const shiftedTrack = baseTrack.map(([la, lo]): [number, number] => [la + 0.0085, lo - 0.0065]);
  const lockedMatch = matchGpsToWorldRoads(shiftedTrack);
  assert.ok(lockedMatch && lockedMatch.world.id === 'alula');
  const rigidAligned = alignCoordsToMyWhooshWorld(alulaWorld, shiftedTrack);
  assert.equal(rigidAligned.mode, 'rigid-road-lock');
  assert.equal(rigidAligned.alignedCoords.length, shiftedTrack.length);
  assert.ok((rigidAligned.rmsErrorM ?? 99) < 15);

  // 5c. Free Ride con un 30% de extensión/intersección nueva no cartografiada + desplazamiento -> Huber lock
  const splitIdx = Math.floor(shiftedTrack.length * 0.72);
  const lastShifted = shiftedTrack[splitIdx - 1];
  const freeRideTrack: Array<[number, number]> = shiftedTrack.map((pt, i) =>
    i < splitIdx ? pt : [lastShifted[0] + (i - splitIdx + 1) * 0.0018, lastShifted[1] + (i - splitIdx + 1) * 0.0015]
  );
  const freeRideAligned = alignCoordsToMyWhooshWorld(alulaWorld, freeRideTrack);
  assert.equal(freeRideAligned.mode, 'rigid-road-lock');
  assert.equal(freeRideAligned.alignedCoords.length, freeRideTrack.length);

  // 5d. Mundo esquemático / traza degenerada -> centered dentro de los bounds
  const bhutanWorld = getMyWhooshWorldByIdOrName('bhutan')!;
  const centeredAligned = alignCoordsToMyWhooshWorld(bhutanWorld, [
    [43.36, -5.85],
    [43.38, -5.86],
    [43.39, -5.84],
  ]);
  assert.equal(centeredAligned.mode, 'centered');
  assert.equal(centeredAligned.alignedCoords.length, 3);
  const [[bS, bW], [bN, bE]] = bhutanWorld.bounds;
  for (const [lat, lon] of centeredAligned.alignedCoords) {
    assert.ok(lat >= bS && lat <= bN && lon >= bW && lon <= bE, 'Centered track must fit inside Bhutan bounds');
  }

  // 5e. Mundo esquemático sin red viaria (Bled) y alineación cross-latitude + rotación arbitraria en Grupo B (Canada -32°)
  const bledWorld = getMyWhooshWorldByIdOrName('bled')!;
  const bledCentered = alignCoordsToMyWhooshWorld(
    bledWorld,
    Array.from({ length: 12 }, (_, i) => [43.36 + i * 0.002, -5.85 - i * 0.002] as [number, number])
  );
  assert.equal(bledCentered.mode, 'centered');

  const canadaWorld = getMyWhooshWorldByIdOrName('canada')!;
  const canadaNet = (roadsDataset.worlds as unknown as Record<string, { tracks?: Array<Array<[number, number]>> }>).canada;
  const canadaTrack = canadaNet.tracks![0];
  const cOrigin = canadaTrack[0];
  const cosCan = Math.cos((cOrigin[0] * Math.PI) / 180);
  const rad32 = (32 * Math.PI) / 180;
  const canadaAbuQraynShifted = canadaTrack.map(([la, lo]): [number, number] => {
    const x = (lo - cOrigin[1]) * cosCan;
    const y = la - cOrigin[0];
    const rx = x * Math.cos(rad32) - y * Math.sin(rad32);
    const ry = x * Math.sin(rad32) + y * Math.cos(rad32);
    return [24.55 + ry, 54.45 + rx / Math.cos((24.55 * Math.PI) / 180)];
  });
  const canadaAligned = alignCoordsToMyWhooshWorld(canadaWorld, canadaAbuQraynShifted);
  assert.equal(canadaAligned.mode, 'rigid-road-lock');
  assert.ok((canadaAligned.rmsErrorM ?? 99) < 8, `Expected crisp cross-latitude lock for Canada, got RMS ${canadaAligned.rmsErrorM}`);

  // 6. FIT virtual MyWhoosh con nombre de archivo genérico + Health Sync CSV con título virtual
  const mwEncoder = new FitEncoder();
  const mwDate = new Date('2026-08-18T09:00:00Z');
  const mwFitTs = FitEncoder.toFitTimestamp(mwDate);
  const degSemi = (d: number) => Math.round((d * 2147483648) / 180);
  const devNameBytes = FitEncoder.string('MyWhoosh');
  mwEncoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: mwFitTs },
  ], 0);
  mwEncoder.writeMessage(23, [
    { number: 0, size: 1, baseType: FitBaseType.Uint8, value: 0 },
    { number: 27, size: devNameBytes.byteLength, baseType: FitBaseType.String, value: devNameBytes },
  ], 3);
  mwEncoder.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: mwFitTs + 900 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: mwFitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 2 }, // cycling
    { number: 6, size: 1, baseType: FitBaseType.Enum, value: 58 }, // virtual_activity
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 900 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 900 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 8500 * 100 },
  ], 1);
  mwEncoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: mwFitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degSemi(baseTrack[0][0]) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degSemi(baseTrack[0][1]) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 0 },
  ], 2);
  mwEncoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: mwFitTs + 900 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degSemi(baseTrack[10][0]) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degSemi(baseTrack[10][1]) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 8500 * 100 },
  ], 2);
  const mwFitBytes = mwEncoder.close();
  const mwFitBuf = Buffer.from(mwFitBytes.buffer, mwFitBytes.byteOffset, mwFitBytes.byteLength);
  const fitParsed = await parseUploadedActivityFile('2026.08.18 11.00-CYCLING.fit', mwFitBuf);
  assert.equal(fitParsed.activities.length, 1);
  assert.equal(fitParsed.activities[0].sport, 'mywhoosh');
  assert.equal(fitParsed.activities[0].worldName, 'AlUla');

  const csvOverride = applyHealthSyncMetadata(
    {
      ...fitParsed.activities[0],
      sport: 'cycling',
      subSport: 'Carretera',
      worldName: undefined,
      title: 'CYCLING',
    },
    {
      originApp: 'MyWhoosh',
      activityType: 'VIRTUAL_RIDE',
      activityName: 'MyWhoosh Free Ride Hudayriyat',
      dateTimeRaw: null,
      elapsedSec: 900,
      activeSec: 900,
      distanceMeters: 8500,
      calories: 250,
      steps: null,
      avgHr: 145,
      maxHr: 165,
      avgSpeedMs: null,
      maxSpeedMs: null,
    }
  );
  assert.equal(csvOverride.sport, 'mywhoosh');
  assert.equal(csvOverride.worldName, 'Hudayriyat');

  // 7. Migración backfillMyWhooshWorlds: corrige sesiones históricas sin tocar salidas outdoor reales
  const legacyMw = createActivity({
    id: 'act_legacy_mw_backfill',
    externalId: null,
    source: 'strava',
    sport: 'cycling',
    subSport: 'Carretera',
    title: 'MyWhoosh - Culture Ride',
    description: null,
    startedAt: '2026-08-19T10:00:00Z',
    durationSec: 1800,
    movingTimeSec: 1800,
    distanceMeters: 18000,
    elevationGain: 150,
    elevationLoss: 150,
    avgSpeedMs: 10,
    maxSpeedMs: 13,
    avgHr: 148,
    maxHr: 168,
    avgWatts: 215,
    normalizedPower: 225,
    maxWatts: 350,
    avgCadence: 88,
    calories: 420,
    tss: 55,
    rpe: 6,
    gearId: null,
    worldName: null,
    polyline: encodePolyline(baseTrack.slice(0, 12)),
    startLat: baseTrack[0][0],
    startLon: baseTrack[0][1],
    points: [],
    strengthLogs: [],
    totalVolumeKg: null,
    extras: { deviceName: 'MyWhoosh' },
    createdAt: new Date().toISOString(),
  });
  assert.equal(legacyMw.worldName, null);

  const realOutdoor = createActivity({
    id: 'act_real_zurich_outdoor',
    externalId: null,
    source: 'gpx',
    sport: 'cycling',
    subSport: 'Carretera',
    title: 'Morning Commute Zurich',
    description: null,
    startedAt: '2026-08-20T07:30:00Z',
    durationSec: 1200,
    movingTimeSec: 1200,
    distanceMeters: 7500,
    elevationGain: 90,
    elevationLoss: 80,
    avgSpeedMs: 6.25,
    maxSpeedMs: 10,
    avgHr: 130,
    maxHr: 152,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: null,
    calories: 210,
    tss: 25,
    rpe: 4,
    gearId: null,
    worldName: null,
    polyline: encodePolyline([
      [47.3769, 8.5417],
      [47.3792, 8.5448],
    ]),
    startLat: 47.3769,
    startLon: 8.5417,
    points: [],
    strengthLogs: [],
    totalVolumeKg: null,
    extras: { deviceName: 'Garmin Edge 540' },
    createdAt: new Date().toISOString(),
  });

  const db = getDb();
  const updatedCount = backfillMyWhooshWorlds(db);
  assert.ok(updatedCount >= 1);
  assert.equal(backfillMyWhooshWorlds(db), 0, 'backfillMyWhooshWorlds must be idempotent');

  const migrated = getActivityById('act_legacy_mw_backfill');
  assert.equal(migrated?.sport, 'mywhoosh');
  assert.equal(migrated?.worldName, 'AlUla');

  const untouchedOutdoor = getActivityById(realOutdoor.id);
  assert.equal(untouchedOutdoor?.sport, 'cycling');
  assert.equal(untouchedOutdoor?.worldName, null);
});

test('Analytics engine computes splits, GAP, best efforts, HR/pace zones, terrain and extras', () => {
  assert.ok(calculateMinettiGapFactor(10) > 1.5);
  assert.ok(calculateMinettiGapFactor(-10) < 0.85);

  // Construimos 6.2 km de carrera ondulada con pulso, cadencia y temperatura
  const pts = Array.from({ length: 125 }, (_, i) => {
    const dist = i * 50;
    const t = i * 14; // ~4:40 min/km base
    const ele = 150 + Math.sin(i / 10) * 35 + i * 0.4;
    return {
      t,
      lat: 43.36 + i * 0.00038,
      lon: -5.85 - i * 0.00022,
      ele: Math.round(ele * 10) / 10,
      hr: 142 + (i % 25),
      cad: 86 + (i % 4), // 86-89 ciclo simple -> debe normalizarse a ~172-178 spm
      temp: 16 + (i % 3),
      dist,
    };
  });

  const enriched = enrichPointsTelemetry(pts, 'running');
  assert.ok(enriched[10].cad && enriched[10].cad >= 168);
  assert.ok(typeof enriched[10].grade === 'number');

  const splits = computeKmSplits(enriched, 'running');
  assert.ok(splits.length >= 6);
  assert.ok(splits[0].gapSpeedMs && splits[0].avgSpeedMs);

  const efforts = computeBestEfforts(enriched, 'running');
  assert.ok(efforts.some((e) => e.label === '400 m'));
  assert.ok(efforts.some((e) => e.label === '1 km'));
  assert.ok(efforts.some((e) => e.label === '5 km'));

  const hrZones = computeHeartRateZones(enriched, getAthleteProfile());
  assert.equal(hrZones.length, 5);
  assert.ok(hrZones.reduce((s, z) => s + z.seconds, 0) > 1000);

  const paceZones = computePaceZones(enriched, 'running');
  assert.equal(paceZones.length, 5);

  const terrain = computeTerrainBreakdown(enriched);
  assert.equal(terrain.length, 3);

  const extras = computeSessionExtras(
    {
      sport: 'running',
      durationSec: 1736,
      movingTimeSec: 1736,
      distanceMeters: 6200,
      elevationGain: 120,
      avgSpeedMs: 3.57,
      avgHr: 154,
      avgWatts: null,
      normalizedPower: null,
      extras: null,
    },
    enriched
  );
  assert.ok(extras.avgTemp !== null && extras.avgTemp !== undefined);
  assert.ok(extras.gapSpeedMs !== null && extras.gapSpeedMs !== undefined);
});

test('Segments engine seeds initial segments, detects climb candidates and matches new activities', () => {
  const segs = listSegments('all');
  assert.ok(segs.length >= 3, 'Should seed initial segments across Naranco, Pista Finlandesa and Hudayriyat');

  const narancoSeg = segs.find((s) => s.name.includes('Naranco'));
  assert.ok(narancoSeg, 'Seeded Naranco segment should exist');
  const detail = getSegmentWithEfforts(narancoSeg.id);
  assert.ok(detail && detail.efforts.length >= 2, 'Naranco segment should match multiple historical runs');

  // Verificar detalle enriquecido de actividad existente
  const actDetail = getActivityById('act_seed_mtn_1');
  assert.ok(actDetail);
  assert.ok(actDetail.kmSplits && actDetail.kmSplits.length >= 10);
  assert.ok(actDetail.segmentEfforts && actDetail.segmentEfforts.length >= 1);
  assert.ok(actDetail.hrZones && actDetail.hrZones.length === 5);

  // Crear un nuevo segmento personalizado en un recorrido con subida y emparejarlo
  const routePts = Array.from({ length: 60 }, (_, i) => ({
    t: i * 15,
    lat: 43.5 + i * 0.00045,
    lon: -5.9 + i * 0.0002,
    ele: i < 10 ? 100 : i < 45 ? 100 + (i - 10) * 6 : 310,
    hr: 158,
    watts: 260,
    dist: i * 55,
  }));
  const climbs = detectClimbCandidates(routePts);
  assert.ok(climbs.length >= 1, 'Should detect synthetic climb >45m gain and >3% grade');

  const baseActivity = createActivity({
    id: 'act_seg_test_climb',
    externalId: null,
    source: 'gpx',
    sport: 'mountain',
    subSport: 'Trail Running',
    title: 'Subida de Prueba Segmento',
    description: null,
    startedAt: new Date().toISOString(),
    durationSec: 885,
    movingTimeSec: 885,
    distanceMeters: 3245,
    elevationGain: 210,
    elevationLoss: 0,
    avgSpeedMs: 3.66,
    maxSpeedMs: 4.5,
    avgHr: 158,
    maxHr: 174,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: 166,
    calories: 320,
    tss: 44,
    rpe: 7,
    gearId: null,
    worldName: null,
    polyline: null,
    startLat: 43.5,
    startLon: -5.9,
    points: routePts,
    strengthLogs: [],
    totalVolumeKg: null,
    laps: [],
    extras: null,
    createdAt: new Date().toISOString(),
  });

  const built = buildSegmentFromRange({
    activity: baseActivity,
    points: routePts,
    startDistM: climbs[0].startDistM,
    endDistM: climbs[0].endDistM,
    name: 'Test Ascenso Sintético',
    category: 'climb',
  });
  assert.ok(built);
  const createdSeg = createSegmentAndMatch(built);
  assert.ok(createdSeg.matchedEfforts >= 1);

  const directMatch = matchPointsToSegment(baseActivity, routePts, built);
  assert.ok(directMatch && directMatch.durationSec > 100);
});

test('MyWhoosh native sync engine encrypts secrets, validates URLs, refreshes tokens and imports FIT/BOM-GPX rides', async () => {
  // 1. Cifrado simétrico AES-256-GCM
  const cipher = encryptSecret('mi-clave-super-secreta');
  assert.ok(cipher.startsWith('v1:'));
  assert.notEqual(cipher, 'mi-clave-super-secreta');
  assert.equal(decryptSecret(cipher), 'mi-clave-super-secreta');

  // 2. Decodificación exp JWT
  const futureExp = Math.floor(Date.now() / 1000) + 14 * 86400;
  const makeJwt = (exp: number) =>
    `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.sig`;
  const validJwt = makeJwt(futureExp);
  const soonExpiringJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
  assert.equal(decodeJwtExpiry(validJwt), futureExp);

  // 3. Validación anti-SSRF de URLs firmadas
  assert.doesNotThrow(() =>
    validateMyWhooshDownloadUrl('https://mywhooshprod.s3.eu-west-1.amazonaws.com/ride/123/abc.fit?X-Amz-Signature=deadbeef')
  );
  for (const unsafe of [
    'http://mywhooshprod.s3.amazonaws.com/ride.fit',
    'https://localhost/ride.fit',
    'https://127.0.0.1/ride.fit',
    'https://192.168.1.47/ride.fit',
    'https://evil.example.com/ride.fit',
  ]) {
    assert.throws(() => validateMyWhooshDownloadUrl(unsafe), `Should reject unsafe URL: ${unsafe}`);
  }

  // 4. Parseo de respuesta de actividades con distintos formatos de fecha
  const parsedPage = parseMyWhooshActivityPage(
    {
      data: {
        totalPages: 1,
        results: [
          {
            id: 'mw-act-1',
            activityFileId: 'mw-file-1',
            title: 'Jebel Jais Climb',
            startDatetime: '2026-11-05T17:30:00.000Z',
            worldName: 'Arabia',
          },
          {
            id: 'mw-act-2',
            activityFileId: 'mw-file-2',
            title: 'Hudayriyat Evening Spin',
            date: 1762444800_000,
          },
        ],
      },
    },
    1
  );
  assert.equal(parsedPage.items.length, 2);
  assert.equal(parsedPage.items[0].activityFileId, 'mw-file-1');
  assert.ok(parsedPage.items[1].startedAt?.startsWith('2025-'));

  // 5. Detección binaria de FIT / DMS y GPX con BOM UTF-8
  const bomGpx = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MyWhoosh" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">
  <trk><name>Hudayriyat Evening Spin</name><type>VirtualRide</type><trkseg>
    <trkpt lat="24.410" lon="54.340"><ele>12</ele><time>2026-11-06T18:00:00Z</time><extensions><power>210</power><gpxtpx:TrackPointExtension><gpxtpx:hr>145</gpxtpx:hr><gpxtpx:cad>88</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="24.414" lon="54.345"><ele>15</ele><time>2026-11-06T18:05:00Z</time><extensions><power>235</power><gpxtpx:TrackPointExtension><gpxtpx:hr>152</gpxtpx:hr><gpxtpx:cad>91</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
    <trkpt lat="24.418" lon="54.350"><ele>18</ele><time>2026-11-06T18:10:00Z</time><extensions><power>245</power><gpxtpx:TrackPointExtension><gpxtpx:hr>158</gpxtpx:hr><gpxtpx:cad>92</gpxtpx:cad></gpxtpx:TrackPointExtension></extensions></trkpt>
  </trkseg></trk>
</gpx>`,
      'utf8'
    ),
  ]);
  const extractedBom = extractMyWhooshActivityBuffer(bomGpx, 'mw-act-2');
  assert.equal(extractedBom.fileName, 'mywhoosh_mw-act-2.gpx');

  // Construir FIT binario real con evento incompleto (caso FitTrackee) y timestamp válido
  const encoder = new FitEncoder();
  const baseDate = new Date('2026-11-05T17:30:00Z');
  const fitTs = FitEncoder.toFitTimestamp(baseDate);
  const degToSemi = (deg: number) => Math.round((deg * 2147483648) / 180);
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
  ], 0);
  encoder.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 1200 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 2 }, // cycling
    { number: 6, size: 1, baseType: FitBaseType.Enum, value: 58 }, // virtual_activity
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 1200 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 1200 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 12500 * 100 },
    { number: 20, size: 2, baseType: FitBaseType.Uint16, value: 245 }, // avg_power
  ], 1);
  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(23.40) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(52.20) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 0 },
    { number: 7, size: 2, baseType: FitBaseType.Uint16, value: 240 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 150 },
    { number: 4, size: 1, baseType: FitBaseType.Uint8, value: 90 },
  ], 2);
  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 1200 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(23.48) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(52.24) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 12500 * 100 },
    { number: 7, size: 2, baseType: FitBaseType.Uint16, value: 255 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 164 },
    { number: 4, size: 1, baseType: FitBaseType.Uint8, value: 94 },
  ], 2);
  const fitUint8 = encoder.close();
  const fitBuf = Buffer.from(fitUint8.buffer, fitUint8.byteOffset, fitUint8.byteLength);

  // 6. Mock completo de API MyWhoosh (login + player-data + refresh 401->200 + S3 FIT/GPX)
  let refreshedOnce = false;
  let activitiesCalls = 0;
  const mockFetch: FetchLike = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const authHeader =
      init?.headers && !Array.isArray(init.headers)
        ? (init.headers as Record<string, string>).Authorization || (init.headers as Record<string, string>).authorization
        : undefined;

    if (url.includes('/http-service/api/login')) {
      return new Response(
        JSON.stringify({
          Success: true,
          AccessToken: soonExpiringJwt,
          RefreshToken: 'mw-refresh-1',
          WhooshId: 'rider-999',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/http-service/api/tokens/generate')) {
      refreshedOnce = true;
      return new Response(
        JSON.stringify({
          AccessToken: validJwt,
          RefreshToken: 'mw-refresh-2',
          WhooshId: 'rider-999',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/player/player-data')) {
      return new Response(
        JSON.stringify({
          PlayerDataStruct: {
            PlayerProfileStruct: { PlayerFirstName: 'Raul', PlayerLastName: 'Oviedo' },
            PlayerPersonalStruct: { FtpPlayer: 262 },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v2/rider/profile/activities')) {
      activitiesCalls++;
      if (authHeader === `Bearer ${soonExpiringJwt}`) {
        return new Response('Unauthorized', { status: 401 });
      }
      return new Response(
        JSON.stringify({
          data: {
            totalPages: 1,
            results: [
              {
                id: 'mw-fit-100',
                activityFileId: 'file-fit-100',
                title: 'Subida Jebel Jais',
                startDatetime: '2026-11-05T17:30:00.000Z',
                worldName: 'Arabia',
              },
              {
                id: 'mw-gpx-101',
                activityFileId: 'file-gpx-101',
                title: 'Hudayriyat Evening Spin',
                startDatetime: '2026-11-06T18:00:00.000Z',
                worldName: 'Hudayriyat',
              },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/v2/rider/profile/download-activity-file')) {
      const parsedBody = JSON.parse(String(init?.body || '{}')) as { fileId?: string };
      const signed =
        parsedBody.fileId === 'file-fit-100'
          ? 'https://mywhooshprod.s3.eu-west-1.amazonaws.com/ride/rider-999/file-fit-100.dms'
          : 'https://mywhooshprod.s3.eu-west-1.amazonaws.com/ride/rider-999/file-gpx-101.gpx';
      return new Response(JSON.stringify({ data: signed }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('file-fit-100.dms')) {
      assert.equal(authHeader, undefined, 'Must not forward Bearer token to S3');
      return new Response(new Uint8Array(fitBuf), { status: 200 });
    }
    if (url.includes('file-gpx-101.gpx')) {
      assert.equal(authHeader, undefined, 'Must not forward Bearer token to S3');
      return new Response(new Uint8Array(bomGpx), { status: 200 });
    }
    return new Response('Not found', { status: 404 });
  };

  const connectedStatus = await connectMyWhooshAccount(
    {
      email: 'raul@example.com',
      password: 'secret-password',
      rememberPassword: false,
      autoSyncEnabled: true,
      syncIntervalMin: 15,
    },
    mockFetch
  );
  assert.equal(connectedStatus.connected, true);
  assert.equal(connectedStatus.riderName, 'Raul Oviedo');
  assert.equal(connectedStatus.ftpWatts, 262);
  assert.equal(connectedStatus.hasSavedPassword, false);
  assert.equal(connectedStatus.autoSyncEnabled, true);

  const firstSync = await syncMyWhooshActivities({ fetchImpl: mockFetch });
  assert.equal(refreshedOnce, true, 'Should refresh soon-to-expire token automatically');
  assert.ok(activitiesCalls >= 1);
  assert.equal(firstSync.imported, 2);
  assert.equal(firstSync.failed, 0);

  const allActivities = listActivities({ sport: 'mywhoosh' });
  const fitImported = allActivities.find((a) => a.externalId === 'mywhoosh_mw-fit-100');
  const gpxImported = allActivities.find((a) => a.externalId === 'mywhoosh_mw-gpx-101');
  assert.ok(fitImported, 'FIT activity from MyWhoosh should be persisted');
  assert.equal(fitImported.source, 'mywhoosh');
  assert.equal(fitImported.title, 'Subida Jebel Jais');
  assert.equal(fitImported.worldName, 'Arabia');
  assert.ok(gpxImported, 'BOM-GPX activity from MyWhoosh should be persisted');
  assert.equal(gpxImported.worldName, 'Hudayriyat');

  // Segunda sincronización debe omitir las 2 existentes sin duplicar
  const secondSync = await syncMyWhooshActivities({ fetchImpl: mockFetch });
  assert.equal(secondSync.imported, 0);
  assert.equal(secondSync.skipped, 2);

  // Preferencias y desconexión mantienen actividades
  const updatedPrefs = updateMyWhooshSyncPreferences({ autoSyncEnabled: false, syncIntervalMin: 30 });
  assert.equal(updatedPrefs.autoSyncEnabled, false);
  assert.equal(updatedPrefs.syncIntervalMin, 30);

  const afterDisconnect = disconnectMyWhoosh();
  assert.equal(afterDisconnect.connected, false);
  assert.ok(getMyWhooshStatus().importedCount >= 2, 'Imported MyWhoosh rides remain in Bilifit after disconnect');
});

test('Huawei Health parsers, Health Sync smart bundling, local watch folder and Google Drive sync work end-to-end', async () => {
  // 1. Parser HiTrack nativo (ignora centinelas lat=90,lon=-80 y lat=0,lon=0)
  const hitrackText = [
    'tp=lbs;k=1;lat=0.0;lon=0.0;alt=0;t=0',
    'tp=lbs;k=2;lat=43.37845;lon=-5.81892;alt=193;t=1785219720',
    'tp=lbs;k=3;lat=43.38120;lon=-5.81650;alt=210;t=1785220020',
    'tp=lbs;k=4;lat=90.0;lon=-80.0;alt=0;t=0',
    'tp=h-r;k=1785219720;v=142',
    'tp=h-r;k=1785220020;v=164',
    'tp=s-r;k=1785219720;v=168',
    'tp=s-r;k=1785220020;v=174',
    'tp=alti;k=1785219720;v=195.5',
    'tp=alti;k=1785220020;v=214.0',
    'tp=rs;k=0;v=33',
  ].join('\n');

  const hiParsed = parseHiTrackText(hitrackText, {
    fileName: 'HiTrack_1785219720000',
    sportTypeCode: 4,
    startTimeMs: 1785219720_000,
    totalTimeMs: 300_000,
    totalDistanceM: 1250,
    caloriesKcal: 112,
    steps: 1480,
  });
  assert.equal(hiParsed.sport, 'running');
  assert.equal(hiParsed.distanceMeters, 1250);
  assert.equal(hiParsed.calories, 112);
  assert.equal(hiParsed.extras?.steps, 1480);
  assert.ok(hiParsed.points.length >= 2);
  assert.ok(hiParsed.points.every((p) => p.lat !== 90 && p.lat !== 0));

  // 2. Parser JSON Centro de Privacidad Huawei (incluyendo partTimeMap malformado) + ZIP
  const huaweiPrivacyJson = `[{
    "recordDay": 20260728,
    "partTimeMap": {0:1234, 60:5678},
    "motionPathData": [{
      "sportType": 282,
      "startTime": 1785314067000,
      "timeZone": "+0200",
      "attribute": "HW_EXT_TRACK_DETAIL@is${hitrackText.replace(/\n/g, '\\n')}&&HW_EXT_TRACK_SIMPLIFY@is{\\"totalDistance\\": 6420, \\"totalTime\\": 2700000, \\"totalCalories\\": 512000, \\"avgHeartRate\\": 138, \\"maxHeartRate\\": 166, \\"totalSteps\\": 7890}"
    }]
  }]`;
  const motionList = parseHuaweiMotionPathJson(huaweiPrivacyJson, 'motion path detail data.json');
  assert.equal(motionList.length, 1);
  assert.equal(motionList[0].sport, 'mountain');
  assert.equal(motionList[0].distanceMeters, 6420);
  assert.equal(motionList[0].calories, 512);
  assert.equal(motionList[0].extras?.steps, 7890);

  const privacyZip = new JSZip();
  privacyZip.file('Motion path detail data & description/motion path detail data1785314067.json', huaweiPrivacyJson);
  const privacyZipBuf = await privacyZip.generateAsync({ type: 'nodebuffer' });
  const zipParsed = await parseUploadedActivityFile('huawei_privacy_export.zip', privacyZipBuf);
  assert.equal(zipParsed.activities.length, 1);
  assert.equal(zipParsed.activities[0].sport, 'mountain');

  // 3. Health Sync CSV + agrupación inteligente (.fit > .tcx > .gpx, ignorando .kml)
  const csvSample = [
    'Aplicación de origen,Tipo de actividad,Nombre de la actividad,Fecha,Hora,Tiempo transcurrido,Tiempo activo,Distancia (km),Calorías (kcal),Pasos,Frecuencia cardíaca media,Frecuencia cardíaca máxima,Velocidad media,Máxima velocidad,Estilo principal,Número de brazadas,Número de largos',
    'HuaweiHealth,RUNNING,Rodaje Naranco Matinal,2026.07.28 08.22,08:22:00,1809,1806,4.2,319.0,5120,152,169,8.37,14.76,,0,0',
  ].join('\n');
  const csvMeta = parseHealthSyncCsv(csvSample);
  assert.ok(csvMeta);
  assert.equal(csvMeta.activityName, 'Rodaje Naranco Matinal');
  assert.equal(csvMeta.steps, 5120);
  assert.equal(csvMeta.originApp, 'HuaweiHealth');

  // Construir FIT válido de Health Sync
  const encoder = new FitEncoder();
  const runDate = new Date('2026-07-28T06:22:00Z');
  const fitTs = FitEncoder.toFitTimestamp(runDate);
  const degToSemi = (deg: number) => Math.round((deg * 2147483648) / 180);
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
  ], 0);
  encoder.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 1806 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 }, // running
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 1809 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 1806 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 4200 * 100 },
  ], 1);
  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(43.378) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(-5.818) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 0 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 145 },
  ], 2);
  encoder.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 1806 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(43.395) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(-5.805) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 4200 * 100 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 162 },
  ], 2);
  const fitUint8 = encoder.close();
  const hsFitBuf = Buffer.from(fitUint8.buffer, fitUint8.byteOffset, fitUint8.byteLength);

  const gpxDummy = Buffer.from(
    `<gpx version="1.1"><trk><name>RUNNING</name><trkseg><trkpt lat="43.378" lon="-5.818"><time>2026-07-28T06:22:00Z</time></trkpt></trkseg></trk></gpx>`,
    'utf8'
  );

  const grouped = groupHealthSyncFiles([
    { fileName: '2026.07.28 08.22-RUNNING.kml', item: 'kml' },
    { fileName: '2026.07.28 08.22-RUNNING.gpx', item: 'gpx' },
    { fileName: '2026.07.28 08.22-RUNNING.fit', item: 'fit' },
    { fileName: 'RUNNING 2026.07.28 08.22 Strava.csv', item: 'csv' },
  ]);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].primary.item, 'fit');
  assert.equal(grouped[0].csvMetaItem?.item, 'csv');

  const batchParsed = await parseUploadedActivityBatch([
    { fileName: '2026.07.28 08.22-RUNNING.gpx', buffer: gpxDummy },
    { fileName: '2026.07.28 08.22-RUNNING.fit', buffer: hsFitBuf },
    { fileName: 'RUNNING 2026.07.28 08.22 Strava.csv', buffer: Buffer.from(csvSample, 'utf8') },
  ]);
  assert.equal(batchParsed.activities.length, 1);
  assert.equal(batchParsed.activities[0].title, 'Rodaje Naranco Matinal');
  assert.equal(batchParsed.activities[0].extras?.steps, 5120);

  // 4. Sincronización automática desde carpeta local (Watch Folder)
  const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilifit-huawei-watch-'));
  try {
    fs.writeFileSync(path.join(watchDir, '2026.07.28 08.22-RUNNING.fit'), hsFitBuf);
    fs.writeFileSync(path.join(watchDir, '2026.07.28 08.22-RUNNING.gpx'), gpxDummy);
    fs.writeFileSync(path.join(watchDir, 'RUNNING 2026.07.28 08.22 Strava.csv'), csvSample, 'utf8');

    updateHuaweiPreferences({ watchDir, autoSyncEnabled: true, syncIntervalMin: 15 });
    const folderSync1 = await syncHuaweiActivities({ mode: 'folder' });
    assert.equal(folderSync1.imported, 1);
    assert.equal(folderSync1.failed, 0);

    const huaweiActs = listActivities({ sport: 'running' }).filter((a) => a.source === 'huawei');
    assert.ok(huaweiActs.some((a) => a.title === 'Rodaje Naranco Matinal'));

    const folderSync2 = await syncHuaweiActivities({ mode: 'folder' });
    assert.equal(folderSync2.imported, 0);
    assert.equal(folderSync2.skipped, 1);
  } finally {
    fs.rmSync(watchDir, { recursive: true, force: true });
  }

  // 5. Google Drive OAuth + autodescubrimiento carpeta + descarga priorizada (.fit > .gpx) + CSV
  updateHuaweiPreferences({
    googleClientId: 'google-client-123',
    googleClientSecret: 'google-secret-xyz',
  });
  const authUrl = getGoogleDriveAuthUrl('http://localhost:3000', 'state-abc');
  assert.ok(authUrl.includes('drive.readonly') && authUrl.includes('state=state-abc'));

  // Segunda sesión distinta (Caminata 2026.08.15) para probar descarga desde Drive sin colisionar con la de carpeta
  const encWalk = new FitEncoder();
  const walkDate = new Date('2026-08-15T07:10:00Z');
  const walkFitTs = FitEncoder.toFitTimestamp(walkDate);
  encWalk.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: walkFitTs },
  ], 0);
  encWalk.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: walkFitTs + 2400 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: walkFitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 11 }, // walking
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 2400 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 2400 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 3100 * 100 },
  ], 1);
  encWalk.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: walkFitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(43.370) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: degToSemi(-5.840) },
    { number: 5, size: 4, baseType: FitBaseType.Uint32, value: 0 },
  ], 2);
  const walkFitUint8 = encWalk.close();
  const walkFitBuf = Buffer.from(walkFitUint8.buffer, walkFitUint8.byteOffset, walkFitUint8.byteLength);
  const walkCsv = [
    'Aplicación de origen,Tipo de actividad,Nombre de la actividad,Fecha,Hora,Tiempo transcurrido,Tiempo activo,Distancia (km),Calorías (kcal),Pasos',
    'HuaweiHealth,WALKING,Paseo Senda del Oso,2026.08.15 09.10,09:10:00,2400,2400,3.1,195,4320',
  ].join('\n');

  let gpxDownloadAttempted = false;
  const mockGoogleFetch: typeof fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(
        JSON.stringify({
          access_token: 'gdrive-access-token',
          refresh_token: 'gdrive-refresh-token',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/drive/v3/about')) {
      return new Response(JSON.stringify({ user: { emailAddress: 'raul@gmail.com' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('/drive/v3/files') && url.includes('application%2Fvnd.google-apps.folder')) {
      return new Response(
        JSON.stringify({
          files: [{ id: 'folder-hs-1', name: 'Health Sync Actividades', mimeType: 'application/vnd.google-apps.folder' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url.includes('/drive/v3/files/file-walk-fit?alt=media')) {
      return new Response(new Uint8Array(walkFitBuf), { status: 200 });
    }
    if (url.includes('/drive/v3/files/file-walk-gpx?alt=media')) {
      gpxDownloadAttempted = true;
      return new Response(new Uint8Array(gpxDummy), { status: 200 });
    }
    if (url.includes('/drive/v3/files/file-walk-csv?alt=media')) {
      return new Response(walkCsv, { status: 200 });
    }
    if (url.includes('/drive/v3/files?')) {
      return new Response(
        JSON.stringify({
          files: [
            { id: 'file-walk-gpx', name: '2026.08.15 09.10-WALKING.gpx' },
            { id: 'file-walk-fit', name: '2026.08.15 09.10-WALKING.fit' },
            { id: 'file-walk-csv', name: 'WALKING 2026.08.15 09.10 Strava.csv' },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return new Response('Not found', { status: 404 });
  };

  const gdStatus = await exchangeGoogleDriveCode('auth-code-1', 'http://localhost:3000', mockGoogleFetch);
  assert.equal(gdStatus.googleConnected, true);
  assert.equal(gdStatus.googleAccountEmail, 'raul@gmail.com');
  assert.equal(gdStatus.driveFolderId, 'folder-hs-1');
  assert.equal(gdStatus.driveFolderName, 'Health Sync Actividades');

  const driveSync = await syncHuaweiActivities({ mode: 'drive', fetchImpl: mockGoogleFetch });
  assert.equal(driveSync.imported, 1);
  assert.equal(gpxDownloadAttempted, false, 'Should only download .fit and skip redundant .gpx in Drive bundle');

  const walkImported = listActivities({ sport: 'mountain' }).find((a) => a.title === 'Paseo Senda del Oso');
  assert.ok(walkImported, 'Google Drive Huawei walk should be imported with CSV title');
  assert.equal(walkImported.source, 'huawei');
  assert.equal(walkImported.extras?.steps, 4320);

  const afterGdDisconnect = disconnectGoogleDrive();
  assert.equal(afterGdDisconnect.googleConnected, false);
  assert.ok(getHuaweiStatus().importedCount >= 2);
});
