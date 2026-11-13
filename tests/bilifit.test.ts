import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NextRequest } from 'next/server';
import JSZip from 'jszip';
import sharp from 'sharp';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';

// Usar una DB temporal aislada durante los tests
const tmpDb = path.join(os.tmpdir(), `bilifit-test-${Date.now()}.db`);
process.env.BILIFIT_DB_PATH = tmpDb;
process.env.BILIFIT_SECRET = 'bilifit-test-secret';
process.env.BILIFIT_DISABLE_SCHEDULER = '1';

import {
  mapClientXToSvgViewBoxX,
  resolveTelemetryPointIndexFromSvgX,
} from '../src/components/Charts';
import {
  calculateCyclingTSS,
  calculateNormalizedPower,
  calculatePMC,
  computePowerCurve,
  defaultSubSportForSport,
  getEffectiveAvgSpeedMs,
  getEffectiveDurationSec,
  isMismatchedSubSport,
  resolveDisplaySubSport,
  sportColor,
  sportLabel,
} from '../src/lib/metrics';
import { hasConcreteActivityName, resolveActivityTitle } from '../src/lib/activity-naming';
import { previewActivityTrim, resolveTrimSpecFromInput } from '../src/lib/activity-trim';
import { parseFitBuffer } from '../src/lib/parsers/fit';
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
  backfillMismatchedSubSports,
  backfillMyWhooshWorlds,
  backfillSplitTrailActivities,
  backfillWalkingActivities,
  createActivity,
  createCustomEquipment,
  createSegmentAndMatch,
  deleteCustomPalette,
  getActivityById,
  getAppSettings,
  getAthleteProfile,
  getDb,
  getDbPath,
  getSegmentWithEfforts,
  listActivities,
  listHomeEquipment,
  listSegments,
  toggleHomeEquipment,
  updateActivity,
  updateAppSettings,
} from '../src/lib/db';
import { runWithAccount } from '../src/lib/account-context';
import { ACCOUNT_COOKIE_NAME, normalizeAccountId } from '../src/lib/accounts';
import { generateDarkPaletteColors } from '../src/lib/theme-palettes';
import { SETTINGS_SYNC_PROTOCOL, THEMES } from '../src/lib/themes';
import { GET as getSettingsRoute, PUT as putSettingsRoute } from '../src/app/api/settings/route';
import {
  DELETE as deletePaletteRoute,
  PUT as putPaletteRoute,
} from '../src/app/api/settings/custom-palettes/[id]/route';
import { GET as getActivitiesRoute, POST as postActivitiesRoute } from '../src/app/api/activities/route';
import { PATCH as patchActivityRoute } from '../src/app/api/activities/[id]/route';
import { POST as postReloadActivitiesRoute } from '../src/app/api/activities/reload/route';
import { POST as postTrimActivityRoute } from '../src/app/api/activities/[id]/trim/route';
import { GET as getDashboardRoute } from '../src/app/api/dashboard/route';
import { GET as getProfileRoute } from '../src/app/api/profile/route';
import { GET as getHuaweiGoogleAuthRoute } from '../src/app/api/huawei/google/auth/route';
import { GET as getStravaAuthRoute } from '../src/app/api/strava/auth/route';
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
import {
  buildThemedDarkMapStyle,
  DARK_MAP_ATTRIBUTION,
  DARK_MAP_BACKGROUND,
  DARK_MAP_STYLE,
  resolveDarkMapColors,
} from '../src/lib/dark-map-style';

test.after(() => {
  const peqDb = getDbPath('pequenaja');
  for (const base of [tmpDb, peqDb]) {
    for (const suffix of ['', '-wal', '-shm']) {
      const f = `${base}${suffix}`;
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
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
  assert.equal(imported.activities[0].sport, 'trail');
  assert.equal(imported.activities[0].subSport, 'Trail Running');
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
  assert.equal(mapStravaSport('Run', 'TrailRun', 'Trail Picos').sport, 'trail');
  assert.equal(mapStravaSport('Hike', 'Hike', 'Subida Pienzu').sport, 'mountain');
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
    sport: 'trail',
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

  const walkImported = listActivities({ sport: 'walking' }).find((a) => a.title === 'Paseo Senda del Oso');
  assert.ok(walkImported, 'Google Drive Huawei walk should be imported with CSV title under walking sport');
  assert.equal(walkImported.sport, 'walking');
  assert.equal(walkImported.subSport, 'Caminar');
  assert.equal(walkImported.source, 'huawei');
  assert.equal(walkImported.extras?.steps, 4320);

  const afterGdDisconnect = disconnectGoogleDrive();
  assert.equal(afterGdDisconnect.googleConnected, false);
  assert.ok(getHuaweiStatus().importedCount >= 2);
});

test('Caminar (walking) sport classification, analytics, DB backfill, and Oscuro map tile layer', async () => {
  assert.equal(sportLabel('walking'), 'Caminar');
  assert.equal(sportColor('walking'), '#F59E0B');

  // 1. GPX / TCX / Strava / Huawei mapping for walking vs mountain
  const walkGpx = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1" creator="Reloj GPS">
    <trk>
      <name>Caminata por el Parque</name>
      <type>walking</type>
      <trkseg>
        <trkpt lat="43.3600" lon="-5.8500"><ele>220</ele><time>2026-09-01T08:00:00Z</time></trkpt>
        <trkpt lat="43.3645" lon="-5.8500"><ele>225</ele><time>2026-09-01T08:05:00Z</time></trkpt>
        <trkpt lat="43.3690" lon="-5.8500"><ele>222</ele><time>2026-09-01T08:10:00Z</time></trkpt>
      </trkseg>
    </trk>
  </gpx>`;
  const gpxWalk = parseGpxString(walkGpx, 'paseo.gpx');
  assert.equal(gpxWalk.sport, 'walking');
  assert.equal(gpxWalk.subSport, 'Caminar');

  const walkTcx = `<?xml version="1.0" encoding="UTF-8"?>
  <TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
    <Activities>
      <Activity Sport="Walking">
        <Id>2026-09-02T09:00:00Z</Id>
        <Notes>Paseo Matinal</Notes>
        <Lap StartTime="2026-09-02T09:00:00Z">
          <TotalTimeSeconds>600</TotalTimeSeconds>
          <DistanceMeters>1000</DistanceMeters>
          <Track>
            <Trackpoint><Time>2026-09-02T09:00:00Z</Time><Position><LatitudeDegrees>43.360</LatitudeDegrees><LongitudeDegrees>-5.850</LongitudeDegrees></Position><AltitudeMeters>220</AltitudeMeters><Cadence>56</Cadence></Trackpoint>
            <Trackpoint><Time>2026-09-02T09:05:00Z</Time><Position><LatitudeDegrees>43.3645</LatitudeDegrees><LongitudeDegrees>-5.850</LongitudeDegrees></Position><AltitudeMeters>222</AltitudeMeters><Cadence>58</Cadence></Trackpoint>
            <Trackpoint><Time>2026-09-02T09:10:00Z</Time><Position><LatitudeDegrees>43.3690</LatitudeDegrees><LongitudeDegrees>-5.850</LongitudeDegrees></Position><AltitudeMeters>224</AltitudeMeters><Cadence>57</Cadence></Trackpoint>
          </Track>
        </Lap>
      </Activity>
    </Activities>
  </TrainingCenterDatabase>`;
  const tcxWalk = parseTcxString(walkTcx, 'paseo.tcx');
  assert.equal(tcxWalk.sport, 'walking');
  assert.equal(tcxWalk.subSport, 'Caminar');
  assert.equal(tcxWalk.avgCadence, 114); // 57 * 2 spm

  const hiWalk = parseHiTrackText(
    [
      'tp=lbs;k=1;lat=43.3600;lon=-5.8500;alt=220;t=1785400000;',
      'tp=lbs;k=2;lat=43.3645;lon=-5.8500;alt=225;t=1785400300;',
      'tp=s-r;k=1785400060;v=112;',
      'tp=s-r;k=1785400120;v=116;',
    ].join('\n'),
    {
      fileName: 'HiTrack_1785400000',
      sportTypeCode: 5,
      startTimeMs: 1785400000_000,
      totalTimeMs: 300_000,
      totalDistanceM: 500,
    }
  );
  assert.equal(hiWalk.sport, 'walking');
  assert.equal(hiWalk.subSport, 'Caminar');
  assert.ok(hiWalk.points.some((p) => p.cad === 112), 'Already-spm walking cadence >= 80 must not double');

  assert.equal(mapStravaSport('Walk', 'Walk', 'Paseo urbano').sport, 'walking');
  assert.equal(mapStravaSport('Hike', 'Hike', 'Subida al Angliru').sport, 'mountain');
  assert.equal(mapStravaSport('Run', 'TrailRun', 'Trail Picos').sport, 'trail');
  assert.equal(sportLabel('mountain'), 'Senderismo');
  assert.equal(sportLabel('trail'), 'Trail Running');
  assert.equal(sportColor('trail'), '#84CC16');

  // 2. Walking pace zones and stride length extras
  const walkPts = enrichPointsTelemetry(
    [
      { t: 0, lat: 43.36, lon: -5.85, ele: 220, speed: 1.55, cad: 58, hr: 105 },
      { t: 60, lat: 43.3608, lon: -5.85, ele: 222, speed: 1.65, cad: 60, hr: 110 },
      { t: 120, lat: 43.3617, lon: -5.85, ele: 224, speed: 1.75, cad: 62, hr: 114 },
      { t: 180, lat: 43.3626, lon: -5.85, ele: 225, speed: 1.6, cad: 59, hr: 112 },
    ],
    'walking'
  );
  const walkZones = computePaceZones(walkPts, 'walking');
  assert.equal(walkZones.length, 5);
  assert.ok(walkZones.some((z) => z.seconds > 0 && z.zone !== 'Z1'), 'Walking pace zones should differentiate walking speeds');

  const walkExtras = computeSessionExtras(
    {
      sport: 'walking',
      durationSec: 180,
      movingTimeSec: 180,
      distanceMeters: 295,
      elevationGain: 5,
      avgSpeedMs: 1.64,
      avgHr: 110,
      avgWatts: null,
      normalizedPower: null,
      extras: null,
    },
    walkPts
  );
  assert.ok(walkExtras.avgStrideLenM && walkExtras.avgStrideLenM > 0.5 && walkExtras.avgStrideLenM < 1.3);
  assert.ok(walkExtras.gapSpeedMs && walkExtras.gapSpeedMs > 1.4);

  // 3. DB backfill migrates legacy Caminata rows from mountain -> walking without touching genuine mountain hikes
  const db = getDb();
  const legacyWalkId = 'act_legacy_walk_test';
  const realHikeId = 'act_real_hike_test';
  db.prepare(
    `INSERT INTO activities (id, external_id, source, sport, sub_sport, title, started_at, duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss, tss, created_at)
     VALUES (?, ?, 'huawei', 'mountain', 'Caminata', 'Paseo Antiguo', '2026-07-05T08:39:00Z', 1800, 1800, 2500, 30, 30, 20, '2026-07-05T09:15:00Z')`
  ).run(legacyWalkId, 'huawei_ht_1783240740000_5');
  db.prepare(
    `INSERT INTO activities (id, external_id, source, sport, sub_sport, title, started_at, duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss, tss, created_at)
     VALUES (?, ?, 'huawei', 'mountain', 'Senderismo', 'Ruta Picos', '2026-07-06T08:00:00Z', 7200, 7200, 14000, 950, 950, 120, '2026-07-06T10:30:00Z')`
  ).run(realHikeId, 'huawei_ht_1783324800000_282');

  const migratedWalks = backfillWalkingActivities(db);
  assert.ok(migratedWalks >= 1);
  assert.equal(getActivityById(legacyWalkId)?.sport, 'walking');
  assert.equal(getActivityById(legacyWalkId)?.subSport, 'Caminar');
  assert.equal(getActivityById(realHikeId)?.sport, 'mountain');

  // 4. ActivityMap Oscuro mode uses OpenFreeMap monochrome dark vector style + monochrome grayscale fallback (no CartoDB API key tile URL)
  const mapSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'ActivityMap.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');
  assert.ok(!mapSource.includes('basemaps.cartocdn.com'), 'CartoDB dark tiles require API keys and must not be used');
  assert.ok(mapSource.includes('DARK_MAP_STYLE'));
  assert.ok(mapSource.includes("className: 'bilifit-dark-tiles'"));
  assert.ok(cssSource.includes('grayscale(100%)'), 'Fallback raster dark filter must be fully desaturated monochrome');
  assert.ok(cssSource.includes('.bilifit-map-dark'));
  assert.ok(fs.existsSync(path.join(process.cwd(), 'public', 'vendor', 'maplibre-gl-worker.mjs')));
  const pkgJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>;
  };
  assert.equal(pkgJson.scripts?.postinstall, undefined, 'postinstall must not reference scripts/ before Docker builder stage COPY . .');

  assert.equal(DARK_MAP_STYLE.version, 8);
  assert.equal(DARK_MAP_BACKGROUND, '#212121');
  assert.ok(DARK_MAP_ATTRIBUTION.includes('OpenFreeMap'));
  const openMapTiles = DARK_MAP_STYLE.sources.openmaptiles as { type: string; url?: string };
  assert.equal(openMapTiles.type, 'vector');
  assert.equal(openMapTiles.url, 'https://tiles.openfreemap.org/planet');
  assert.ok(DARK_MAP_STYLE.layers.length >= 25);

  // Verify every hex color in DARK_MAP_STYLE stays neutral monochrome/charcoal (max channel spread <= 14)
  const hexMatches = JSON.stringify(DARK_MAP_STYLE).match(/#[0-9a-fA-F]{6}/g) ?? [];
  assert.ok(hexMatches.length >= 20);
  for (const hex of hexMatches) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread <= 14, `Expected monochrome/slate tone in Oscuro map style, got ${hex} (spread=${spread})`);
  }

  // 5. Splitting Senderismo (mountain) vs Trail Running (trail), syncing subSport on edit, and DB backfills
  assert.equal(isMismatchedSubSport('mountain', 'Caminar'), true);
  assert.equal(isMismatchedSubSport('mountain', 'Trail Running'), true);
  assert.equal(isMismatchedSubSport('trail', 'Trail Running'), false);
  assert.equal(isMismatchedSubSport('mountain', 'Senderismo'), false);
  assert.equal(resolveDisplaySubSport('mountain', 'Caminar'), null);
  assert.equal(resolveDisplaySubSport('mountain', 'Trail Running'), null);
  assert.equal(resolveDisplaySubSport('trail', 'Trail Running'), 'Trail Running');
  assert.equal(resolveDisplaySubSport('walking', 'Caminar'), 'Caminar');
  assert.equal(defaultSubSportForSport('mountain'), 'Senderismo');
  assert.equal(defaultSubSportForSport('trail'), 'Trail Running');

  const badgeSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'SportBadge.tsx'), 'utf8');
  assert.ok(badgeSource.includes('resolveDisplaySubSport'));
  assert.ok(badgeSource.includes('TrailRunningIcon'));
  assert.ok(badgeSource.includes("mountain: 'Senderismo'"));
  assert.ok(badgeSource.includes("trail: 'Trail Running'"));

  const editedWalkToMountain = createActivity({
    id: 'act_walk_edited_to_mtn',
    externalId: 'huawei_ht_1789999000000_5',
    source: 'huawei',
    sport: 'walking',
    subSport: 'Caminar',
    title: '2026.09.20 10.53 WALKING',
    description: null,
    startedAt: '2026-09-20T10:53:00Z',
    durationSec: 28020,
    movingTimeSec: 28020,
    distanceMeters: 11790,
    elevationGain: 618,
    elevationLoss: 618,
    avgSpeedMs: 0.88,
    maxSpeedMs: 1.5,
    avgHr: 125,
    maxHr: 162,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: 102,
    calories: 1400,
    tss: 126,
    rpe: 7,
    gearId: null,
    worldName: null,
    polyline: null,
    startLat: null,
    startLon: null,
    points: [],
    strengthLogs: [],
    totalVolumeKg: null,
    createdAt: new Date().toISOString(),
  });
  const updatedToMountain = updateActivity(editedWalkToMountain.id, { sport: 'mountain' });
  assert.equal(updatedToMountain?.sport, 'mountain');
  assert.equal(updatedToMountain?.subSport, 'Senderismo');

  const updatedToTrail = updateActivity(editedWalkToMountain.id, { sport: 'trail' });
  assert.equal(updatedToTrail?.sport, 'trail');
  assert.equal(updatedToTrail?.subSport, 'Trail Running');

  // Re-running backfillWalkingActivities must NOT revert a user-retagged trail/mountain activity
  const updatedBackToHike = updateActivity(editedWalkToMountain.id, { sport: 'mountain' });
  assert.equal(updatedBackToHike?.subSport, 'Senderismo');
  backfillWalkingActivities(db);
  assert.equal(getActivityById(editedWalkToMountain.id)?.sport, 'mountain');
  assert.equal(getActivityById(editedWalkToMountain.id)?.subSport, 'Senderismo');

  // Legacy Trail Running stored under mountain migrates to sport='trail', while stuck mountain/Caminar repairs to Senderismo
  const legacyTrailId = 'act_legacy_trail_split';
  db.prepare(
    `INSERT INTO activities (id, external_id, source, sport, sub_sport, title, started_at, duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss, tss, created_at)
     VALUES (?, ?, 'huawei', 'mountain', 'Trail Running', 'Trail Antiguo', '2026-09-18T08:00:00Z', 3600, 3600, 10000, 450, 450, 75, '2026-09-18T09:10:00Z')`
  ).run(legacyTrailId, 'huawei_ht_1789800000000_118');

  const stuckMtnId = 'act_stuck_mtn_caminar';
  db.prepare(
    `INSERT INTO activities (id, external_id, source, sport, sub_sport, title, started_at, duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss, tss, created_at)
     VALUES (?, ?, 'huawei', 'mountain', 'Caminar', '2026.09.20 10.53 WALKING', '2026-09-20T10:53:00Z', 28020, 28020, 11790, 618, 618, 126, '2026-09-20T18:45:00Z')`
  ).run(stuckMtnId, 'huawei_hs_20260920_1053');

  const splitMigrated = backfillSplitTrailActivities(db);
  assert.ok(splitMigrated >= 1);
  assert.equal(getActivityById(legacyTrailId)?.sport, 'trail');
  assert.equal(getActivityById(legacyTrailId)?.subSport, 'Trail Running');

  const fixedSubSports = backfillMismatchedSubSports(db);
  assert.ok(fixedSubSports >= 1);
  assert.equal(getActivityById(stuckMtnId)?.sport, 'mountain');
  assert.equal(getActivityById(stuckMtnId)?.subSport, 'Senderismo');

  // Direct createActivity with mismatched subSport (e.g. import sportOverride) also normalizes subSport
  const overriddenImport = createActivity({
    id: 'act_import_override_mtn',
    externalId: null,
    source: 'gpx',
    sport: 'mountain',
    subSport: 'Caminar',
    title: 'Ruta Override',
    description: null,
    startedAt: '2026-09-21T08:00:00Z',
    durationSec: 7200,
    movingTimeSec: 7200,
    distanceMeters: 12000,
    elevationGain: 700,
    elevationLoss: 700,
    avgSpeedMs: 1.66,
    maxSpeedMs: 2.5,
    avgHr: 140,
    maxHr: 170,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: null,
    calories: 900,
    tss: 110,
    rpe: 7,
    gearId: null,
    worldName: null,
    polyline: null,
    startLat: null,
    startLon: null,
    points: [],
    strengthLogs: [],
    totalVolumeKg: null,
    createdAt: new Date().toISOString(),
  });
  assert.equal(overriddenImport.subSport, 'Senderismo');

  // Running activities use 'Correr' instead of 'Asfalto' across parsers, display resolution, and DB backfill
  assert.equal(resolveDisplaySubSport('running', 'Asfalto'), 'Correr');
  assert.equal(mapStravaSport('Run', 'Run', 'Rodaje').subSport, 'Correr');
  const gpxRun = parseGpxString(
    `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1"><trk><name>Rodaje</name><type>running</type><trkseg><trkpt lat="43.36" lon="-5.85"><ele>220</ele><time>2026-09-22T08:00:00Z</time></trkpt><trkpt lat="43.365" lon="-5.85"><ele>222</ele><time>2026-09-22T08:05:00Z</time></trkpt></trkseg></trk></gpx>`,
    'rodaje.gpx'
  );
  assert.equal(gpxRun.subSport, 'Correr');
  const legacyAsfaltoId = 'act_legacy_asfalto_run';
  db.prepare(
    `INSERT INTO activities (id, external_id, source, sport, sub_sport, title, started_at, duration_sec, moving_time_sec, distance_meters, elevation_gain, elevation_loss, tss, created_at)
     VALUES (?, NULL, 'strava', 'running', 'Asfalto', 'Rodaje Asfalto Antiguo', '2026-09-22T08:00:00Z', 1800, 1800, 5000, 30, 30, 40, '2026-09-22T08:35:00Z')`
  ).run(legacyAsfaltoId);
  backfillMismatchedSubSports(db);
  assert.equal(getActivityById(legacyAsfaltoId)?.subSport, 'Correr');
});

test('Multi-account profiles, server themes/palettes, doneTogether, and OAuth isolation work end-to-end', async () => {
  // 1. Account resolution & DB separation
  assert.equal(normalizeAccountId('raul'), 'raul');
  assert.equal(normalizeAccountId('pequenaja'), 'pequenaja');
  assert.equal(normalizeAccountId('unknown'), null);
  assert.notEqual(getDbPath('raul'), getDbPath('pequenaja'));

  const raulProfile = runWithAccount('raul', () => getAthleteProfile());
  const peqProfile = runWithAccount('pequenaja', () => getAthleteProfile());
  assert.equal(raulProfile.name, 'Raúl');
  assert.equal(peqProfile.name, 'Pequeñaja');

  // Pequeñaja starts clean (no demo activities from Raúl) while still having home equipment catalog
  const raulActsInitial = runWithAccount('raul', () => listActivities());
  const peqActsInitial = runWithAccount('pequenaja', () => listActivities());
  assert.ok(raulActsInitial.length >= 10);
  assert.equal(peqActsInitial.length, 0);
  const peqEquipment = runWithAccount('pequenaja', () => listHomeEquipment());
  assert.ok(peqEquipment.length >= 10);

  // Separate Huawei watch dirs per account
  const raulHuawei = runWithAccount('raul', () => getHuaweiStatus());
  const peqHuawei = runWithAccount('pequenaja', () => getHuaweiStatus());
  assert.equal(raulHuawei.accountId, 'raul');
  assert.equal(peqHuawei.accountId, 'pequenaja');
  assert.notEqual(raulHuawei.watchDir, peqHuawei.watchDir);

  // 2. Shared Google OAuth App credentials vs per-account tokens & auto-sync activation
  // 2a. Credentials entered on Raúl's profile are shared with Pequeñaja automatically
  runWithAccount('raul', () =>
    updateHuaweiPreferences({
      googleClientId: 'raul-shared-client-id',
      googleClientSecret: 'raul-shared-client-secret',
    })
  );
  const peqInherited = runWithAccount('pequenaja', () => getHuaweiStatus());
  assert.equal(peqInherited.googleConfigured, true);
  assert.equal(peqInherited.sharedOAuthAppConfigured, true);
  assert.equal(peqInherited.googleConnected, false);

  // 2b. Env Google OAuth App credentials work for both accounts with separate tokens
  process.env.GOOGLE_CLIENT_ID = 'shared-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET = 'shared-google-client-secret';
  try {
    const raulSharedStatus = runWithAccount('raul', () => getHuaweiStatus());
    const peqSharedStatus = runWithAccount('pequenaja', () => getHuaweiStatus());
    assert.equal(raulSharedStatus.googleConfigured, true);
    assert.equal(peqSharedStatus.googleConfigured, true);
    assert.equal(peqSharedStatus.hasGoogleEnvCredentials, true);
    assert.equal(peqSharedStatus.sharedOAuthAppConfigured, true);

    // OAuth /auth redirect binds the initiating account inside state (<account>.<hex>)
    const peqAuthReq = new NextRequest('http://localhost:3000/api/huawei/google/auth', {
      headers: { cookie: `${ACCOUNT_COOKIE_NAME}=pequenaja` },
    });
    const peqAuthRes = await getHuaweiGoogleAuthRoute(peqAuthReq);
    assert.equal(peqAuthRes.status, 307);
    const redirectLocation = new URL(peqAuthRes.headers.get('location')!);
    const oauthState = redirectLocation.searchParams.get('state') || '';
    assert.ok(oauthState.startsWith('pequenaja.'), `Expected state to carry pequenaja account prefix, got ${oauthState}`);

    // Exchange Google code exclusively on pequenaja -> autoSyncEnabled activates automatically & raul stays disconnected
    const fakeDriveFetch: FetchLike = async (url) => {
      const target = typeof url === 'string' ? url : url.toString();
      if (target.includes('oauth2.googleapis.com/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'peq-access',
            refresh_token: 'peq-refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (target.includes('googleapis.com/drive/v3/about')) {
        return new Response(JSON.stringify({ user: { emailAddress: 'pequenaja@example.com' } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ files: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    const connectedPeq = await runWithAccount('pequenaja', () =>
      exchangeGoogleDriveCode('dummy-code', 'http://localhost:3000/api/huawei/google/callback', fakeDriveFetch)
    );
    assert.equal(connectedPeq.googleConnected, true);
    assert.equal(connectedPeq.googleAccountEmail, 'pequenaja@example.com');
    assert.equal(connectedPeq.autoSyncEnabled, true);
    assert.equal(runWithAccount('raul', () => getHuaweiStatus()).googleConnected, false);

    runWithAccount('pequenaja', () => disconnectGoogleDrive());
  } finally {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  }

  // Strava auth state also carries account prefix when configured
  process.env.STRAVA_CLIENT_ID = 'strava-shared-id';
  process.env.STRAVA_CLIENT_SECRET = 'strava-shared-secret';
  try {
    const stravaReq = new NextRequest('http://localhost:3000/api/strava/auth', {
      headers: { cookie: `${ACCOUNT_COOKIE_NAME}=pequenaja` },
    });
    const stravaRes = await getStravaAuthRoute(stravaReq);
    assert.equal(stravaRes.status, 307);
    const stravaLoc = new URL(stravaRes.headers.get('location')!);
    assert.ok((stravaLoc.searchParams.get('state') || '').startsWith('pequenaja.'));
  } finally {
    delete process.env.STRAVA_CLIENT_ID;
    delete process.env.STRAVA_CLIENT_SECRET;
  }

  // 3. Themes, custom palettes & /api/settings* isolation
  assert.equal(THEMES.length, 8);
  assert.equal(SETTINGS_SYNC_PROTOCOL, 2);

  const peqHeaders = { cookie: `${ACCOUNT_COOKIE_NAME}=pequenaja` };
  const raulHeaders = { cookie: `${ACCOUNT_COOKIE_NAME}=raul` };

  const putSettingsReq = new NextRequest('http://localhost:3000/api/settings', {
    method: 'PUT',
    headers: { ...peqHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ theme: 'lavanda', dark: false }),
  });
  const putSettingsRes = await putSettingsRoute(putSettingsReq);
  assert.equal(putSettingsRes.status, 200);
  assert.equal(putSettingsRes.headers.get('cache-control')?.includes('no-store'), true);
  const peqSettingsAfterTheme = (await putSettingsRes.json()) as { theme: string; dark: boolean; settingsVersion: number };
  assert.equal(peqSettingsAfterTheme.theme, 'lavanda');
  assert.equal(peqSettingsAfterTheme.dark, false);
  assert.ok(peqSettingsAfterTheme.settingsVersion >= 1);

  // Raúl's theme remains unaffected & direct updateAppSettings increments version
  const getRaulSettingsRes = await getSettingsRoute(
    new NextRequest('http://localhost:3000/api/settings', { headers: raulHeaders })
  );
  const raulSettings = (await getRaulSettingsRes.json()) as { theme: string; dark: boolean };
  assert.equal(raulSettings.theme, 'calido');
  const raulUpdated = runWithAccount('raul', () => updateAppSettings({ dark: true }));
  assert.equal(raulUpdated.dark, true);
  runWithAccount('raul', () => updateAppSettings({ dark: false }));

  // Custom palette upsert + activate + delete via API routes
  const customLight = {
    bg: '#FAF6EF',
    surface: '#FFFFFF',
    ink: '#1E242B',
    primary: '#B84A24',
    accent: '#2D6A4F',
    accent2: '#D97706',
  };
  const customPalette = {
    id: 'pal-test-peq',
    name: 'Bosque Asturias',
    baseTheme: 'bosque' as const,
    light: customLight,
    dark: generateDarkPaletteColors(customLight),
    createdAt: Date.now(),
  };

  const putPalRes = await putPaletteRoute(
    new NextRequest('http://localhost:3000/api/settings/custom-palettes/pal-test-peq', {
      method: 'PUT',
      headers: { ...peqHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ palette: customPalette, activate: true }),
    }),
    { params: Promise.resolve({ id: 'pal-test-peq' }) }
  );
  assert.equal(putPalRes.status, 200);
  const withCustom = (await putPalRes.json()) as { customPaletteId: string | null; customPalettes: Array<{ id: string }> };
  assert.equal(withCustom.customPaletteId, 'pal-test-peq');
  assert.equal(withCustom.customPalettes.some((p) => p.id === 'pal-test-peq'), true);

  const missingPalRes = await putSettingsRoute(
    new NextRequest('http://localhost:3000/api/settings', {
      method: 'PUT',
      headers: { ...peqHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ customPaletteId: 'missing-id' }),
    })
  );
  assert.equal(missingPalRes.status, 409);

  const delPalRes = await deletePaletteRoute(
    new NextRequest('http://localhost:3000/api/settings/custom-palettes/pal-test-peq', {
      method: 'DELETE',
      headers: peqHeaders,
    }),
    { params: Promise.resolve({ id: 'pal-test-peq' }) }
  );
  assert.equal(delPalRes.status, 200);
  const afterDelPal = (await delPalRes.json()) as { customPaletteId: string | null; customPalettes: Array<{ id: string }> };
  assert.equal(afterDelPal.customPaletteId, null);
  assert.equal(afterDelPal.customPalettes.length, 0);

  // Profile route respects cookie
  const peqProfileRes = await getProfileRoute(new NextRequest('http://localhost:3000/api/profile', { headers: peqHeaders }));
  const peqProfilePayload = (await peqProfileRes.json()) as { profile: { name: string } };
  assert.equal(peqProfilePayload.profile.name, 'Pequeñaja');

  // 4. doneTogether API creation, filtering (?together=1), toggling (PATCH), and isolation
  const createTogetherRes = await postActivitiesRoute(
    new NextRequest('http://localhost:3000/api/activities', {
      method: 'POST',
      headers: { ...peqHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Paseo juntos por Oviedo',
        sport: 'walking',
        durationMin: 50,
        distanceKm: 4.5,
        doneTogether: true,
      }),
    })
  );
  assert.equal(createTogetherRes.status, 201);
  const createdTogetherJson = (await createTogetherRes.json()) as { activity: { id: string; doneTogether?: boolean } };
  assert.equal(createdTogetherJson.activity.doneTogether, true);

  const createSoloRes = await postActivitiesRoute(
    new NextRequest('http://localhost:3000/api/activities', {
      method: 'POST',
      headers: { ...peqHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({
        title: 'Entreno en casa solo',
        sport: 'strength',
        durationMin: 30,
        doneTogether: false,
      }),
    })
  );
  assert.equal(createSoloRes.status, 201);
  const createdSoloJson = (await createSoloRes.json()) as { activity: { id: string; doneTogether?: boolean } };
  assert.equal(createdSoloJson.activity.doneTogether, false);

  // Filter ?together=1 only returns activities with doneTogether=true
  const filteredRes = await getActivitiesRoute(
    new NextRequest('http://localhost:3000/api/activities?together=1', { headers: peqHeaders })
  );
  const filteredJson = (await filteredRes.json()) as { activities: Array<{ id: string; doneTogether?: boolean }> };
  assert.equal(filteredJson.activities.length, 1);
  assert.equal(filteredJson.activities[0].id, createdTogetherJson.activity.id);

  // PATCH toggles doneTogether on an activity
  const toggledRes = await patchActivityRoute(
    new NextRequest(`http://localhost:3000/api/activities/${createdSoloJson.activity.id}`, {
      method: 'PATCH',
      headers: { ...peqHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ doneTogether: true }),
    }),
    { params: Promise.resolve({ id: createdSoloJson.activity.id }) }
  );
  assert.equal(toggledRes.status, 200);
  const toggledJson = (await toggledRes.json()) as { activity: { doneTogether?: boolean } };
  assert.equal(toggledJson.activity.doneTogether, true);

  // Raúl's activities do NOT include Pequeñaja's entries
  const raulActsAfter = runWithAccount('raul', () => listActivities());
  assert.equal(raulActsAfter.some((a) => a.id === createdTogetherJson.activity.id), false);

  // Clean up test account settings
  runWithAccount('pequenaja', () => {
    const s = getAppSettings();
    for (const p of s.customPalettes) deleteCustomPalette(p.id);
  });
});

test('Canonical default activity names, stopped time toggle, and activity trimming work end-to-end', async () => {
  // 1. Canonical default naming (<Deporte> · <dd mmm yyyy>) while preserving real names
  assert.equal(hasConcreteActivityName('2026.07.28 08.22-RUNNING.fit'), false);
  assert.equal(hasConcreteActivityName('HiTrack_1760000000000'), false);
  assert.equal(hasConcreteActivityName('Carrera al aire libre · 28 jul'), false);
  assert.equal(hasConcreteActivityName('mw12345'), false);
  assert.equal(hasConcreteActivityName('Hudayriyat Evening Spin'), true);
  assert.equal(hasConcreteActivityName('Subida Jebel Jais'), true);

  assert.equal(resolveActivityTitle('2026.07.28 08.22-RUNNING.fit', 'running', '2026-07-28T06:22:00Z'), 'Correr · 28 jul 2026');
  assert.equal(resolveActivityTitle(null, 'walking', '2026-09-20T10:53:00Z'), 'Caminar · 20 sept 2026');
  assert.equal(resolveActivityTitle('Rodaje Naranco Matinal', 'trail', '2026-07-28T06:22:00Z'), 'Rodaje Naranco Matinal');

  const gpxGeneric = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1" creator="Health Sync">
    <trk>
      <name>2026.07.28 08.22-RUNNING.gpx</name>
      <type>running</type>
      <trkseg>
        <trkpt lat="43.3600" lon="-5.8500"><ele>200</ele><time>2026-07-28T06:22:00Z</time></trkpt>
        <trkpt lat="43.3645" lon="-5.8500"><ele>215</ele><time>2026-07-28T06:25:00Z</time></trkpt>
        <trkpt lat="43.3690" lon="-5.8500"><ele>230</ele><time>2026-07-28T06:28:00Z</time></trkpt>
      </trkseg>
    </trk>
  </gpx>`;
  const parsedGenericGpx = parseGpxString(gpxGeneric, '2026.07.28 08.22-RUNNING.gpx');
  assert.equal(parsedGenericGpx.title, 'Correr · 28 jul 2026');

  const blankManualRes = await postActivitiesRoute(
    new NextRequest('http://localhost:3000/api/activities', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: '',
        sport: 'walking',
        durationMin: 40,
        distanceKm: 3.2,
        startedAt: '2026-09-20T10:53:00Z',
      }),
    })
  );
  assert.equal(blankManualRes.status, 201);
  const blankManualJson = (await blankManualRes.json()) as { activity: { title: string } };
  assert.equal(blankManualJson.activity.title, 'Caminar · 20 sept 2026');

  // 2. Stopped time vs elapsed time metrics & FIT / Health Sync CSV / PATCH toggle
  const pausedSample = {
    durationSec: 3600,
    movingTimeSec: 3000,
    distanceMeters: 10_000,
    avgSpeedMs: 2.78,
    excludePausedTime: false,
  };
  assert.equal(getEffectiveDurationSec(pausedSample), 3600);
  assert.equal(getEffectiveAvgSpeedMs(pausedSample), 2.78);
  assert.equal(getEffectiveDurationSec({ ...pausedSample, excludePausedTime: true }), 3000);
  assert.equal(getEffectiveAvgSpeedMs({ ...pausedSample, excludePausedTime: true }), 3.33);

  const encPausedFit = new FitEncoder();
  const fitT0 = new Date('2026-09-22T07:00:00Z');
  const fitT0Ts = FitEncoder.toFitTimestamp(fitT0);
  const toSemi = (d: number) => Math.round((d * 2147483648) / 180);
  encPausedFit.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: fitT0Ts },
  ], 0);
  encPausedFit.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitT0Ts + 600 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: fitT0Ts },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 600 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 600 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 1500 * 100 },
    { number: 59, size: 4, baseType: FitBaseType.Uint32, value: 450 * 1000 },
  ], 1);
  for (let i = 0; i <= 20; i++) {
    const isPaused = i >= 8 && i <= 12;
    const stepLat = isPaused ? 8 * 0.0005 : (i > 12 ? i - 4 : i) * 0.0005;
    encPausedFit.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitT0Ts + i * 30 },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemi(43.36 + stepLat) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemi(-5.85) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (220 + i + 500) * 5 },
      { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 140 },
      { number: 6, size: 2, baseType: FitBaseType.Uint16, value: isPaused ? 0 : 2800 },
    ], 2);
  }
  const pausedFitBytes = encPausedFit.close();
  const parsedPausedFit = await parseFitBuffer(
    Buffer.from(pausedFitBytes.buffer, pausedFitBytes.byteOffset, pausedFitBytes.byteLength),
    '2026.09.22 09.00-RUNNING.fit'
  );
  assert.equal(parsedPausedFit.durationSec, 600);
  assert.equal(parsedPausedFit.movingTimeSec, 450);
  assert.equal(parsedPausedFit.title, 'Correr · 22 sept 2026');

  const csvMeta = parseHealthSyncCsv(
    `Aplicación de origen,Tipo de actividad,Nombre de la actividad,Fecha,Tiempo transcurrido,Tiempo activo,Distancia (km)\nHuawei Health,running,Carrera con semáforos,2026.09.22 09.00,600,450,1.5`
  );
  assert.equal(csvMeta?.elapsedSec, 600);
  assert.equal(csvMeta?.activeSec, 450);

  // Create activity with paused time, toggle via PATCH, and check dashboard totals
  const nowIso = new Date(Date.now() - 2 * 3600_000).toISOString();
  const trimPoints = Array.from({ length: 21 }, (_, idx) => ({
    t: idx * 60,
    lat: 43.36 + idx * 0.0009,
    lon: -5.85,
    ele: 200 + idx * 5,
    hr: 138 + (idx % 5),
    speed: idx >= 18 ? 0.1 : 3.0,
    dist: Math.min(idx, 18) * 180,
  }));
  const trimTarget = createActivity({
    id: 'act_trim_paused_test',
    externalId: null,
    source: 'fit',
    sport: 'running',
    subSport: 'Correr',
    title: 'Correr · Prueba recorte',
    description: null,
    startedAt: nowIso,
    durationSec: 1200,
    movingTimeSec: 1020,
    distanceMeters: 3240,
    elevationGain: 90,
    elevationLoss: 0,
    avgSpeedMs: 2.7,
    maxSpeedMs: 3.4,
    avgHr: 140,
    maxHr: 155,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: 170,
    calories: 240,
    tss: 35,
    rpe: 6,
    gearId: null,
    worldName: null,
    polyline: encodePolyline(trimPoints.map((p) => [p.lat, p.lon])),
    startLat: trimPoints[0].lat,
    startLon: trimPoints[0].lon,
    points: trimPoints,
    strengthLogs: [],
    totalVolumeKg: null,
    laps: [
      {
        lapNumber: 1,
        name: 'Segmento 1',
        startDistM: 0,
        endDistM: 1800,
        distanceMeters: 1800,
        durationSec: 600,
        movingTimeSec: 600,
        avgSpeedMs: 3.0,
        maxSpeedMs: 3.2,
        elevationGain: 50,
        elevationLoss: 0,
        avgHr: 140,
        maxHr: 150,
        trigger: 'segment',
      },
      {
        lapNumber: 2,
        name: 'Segmento 2',
        startDistM: 1800,
        endDistM: 3240,
        distanceMeters: 1440,
        durationSec: 600,
        movingTimeSec: 420,
        avgSpeedMs: 2.4,
        maxSpeedMs: 3.1,
        elevationGain: 40,
        elevationLoss: 0,
        avgHr: 141,
        maxHr: 155,
        trigger: 'segment',
      },
    ],
    createdAt: nowIso,
  });

  const dashBefore = (await (await getDashboardRoute(new NextRequest('http://localhost:3000/api/dashboard'))).json()) as {
    summary: { weekDurationHours: number };
  };
  const patchExcludeRes = await patchActivityRoute(
    new NextRequest(`http://localhost:3000/api/activities/${trimTarget.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ excludePausedTime: true }),
    }),
    { params: Promise.resolve({ id: trimTarget.id }) }
  );
  assert.equal(patchExcludeRes.status, 200);
  const patchedAct = (await patchExcludeRes.json()) as { activity: { excludePausedTime?: boolean } };
  assert.equal(patchedAct.activity.excludePausedTime, true);

  const dashAfter = (await (await getDashboardRoute(new NextRequest('http://localhost:3000/api/dashboard'))).json()) as {
    summary: { weekDurationHours: number };
  };
  assert.ok(dashAfter.summary.weekDurationHours <= dashBefore.summary.weekDurationHours);

  // 3. Activity trimming (previewOnly + start/end/middle + segment effort recomputation)
  const builtSeg = buildSegmentFromRange({
    activity: trimTarget,
    points: trimPoints,
    startDistM: 360,
    endDistM: 1620,
    name: 'Tramo Trim Test',
    category: 'climb',
  });
  assert.ok(builtSeg);
  const seg = createSegmentAndMatch(builtSeg);
  assert.ok(seg.segment.id);

  const previewOnlyRes = await postTrimActivityRoute(
    new NextRequest(`http://localhost:3000/api/activities/${trimTarget.id}/trim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'end', unit: 'km', toKm: 2.52, previewOnly: true }),
    }),
    { params: Promise.resolve({ id: trimTarget.id }) }
  );
  assert.equal(previewOnlyRes.status, 200);
  const previewOnlyJson = (await previewOnlyRes.json()) as {
    preview: { valid: boolean; newDistanceMeters: number; removedPolyline: string | null; keptCount: number };
  };
  assert.equal(previewOnlyJson.preview.valid, true);
  assert.ok(previewOnlyJson.preview.newDistanceMeters < trimTarget.distanceMeters);
  assert.ok(previewOnlyJson.preview.removedPolyline);
  // Confirm DB was not mutated by previewOnly
  assert.equal(getActivityById(trimTarget.id)?.distanceMeters, 3240);

  // Confirm start trim shifts startedAt and slices laps
  const startSpec = resolveTrimSpecFromInput(trimPoints, { mode: 'start', unit: 'sec', fromSec: 180 });
  const startPreview = previewActivityTrim(trimPoints, 'running', startSpec);
  assert.equal(startPreview.valid, true);

  const middleSpec = resolveTrimSpecFromInput(trimPoints, {
    mode: 'middle',
    unit: 'sec',
    fromSec: 420,
    toSec: 660,
  });
  const middlePreview = previewActivityTrim(trimPoints, 'running', middleSpec);
  assert.equal(middlePreview.valid, true);
  assert.ok(middlePreview.keptCount < trimPoints.length);

  // Execute actual end trim via POST /api/activities/[id]/trim
  const commitEndRes = await postTrimActivityRoute(
    new NextRequest(`http://localhost:3000/api/activities/${trimTarget.id}/trim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'end', unit: 'km', toKm: 2.52 }),
    }),
    { params: Promise.resolve({ id: trimTarget.id }) }
  );
  assert.equal(commitEndRes.status, 200);
  const commitEndJson = (await commitEndRes.json()) as {
    activity: { distanceMeters: number; durationSec: number; points: unknown[]; laps?: unknown[] };
  };
  assert.ok(commitEndJson.activity.distanceMeters <= 2550 && commitEndJson.activity.distanceMeters >= 2400);
  assert.ok(commitEndJson.activity.durationSec < 1200);
  assert.ok(commitEndJson.activity.points.length < trimPoints.length);
  const segEffortsAfterTrim = getSegmentWithEfforts(seg.segment.id);
  assert.ok(segEffortsAfterTrim && segEffortsAfterTrim.efforts.length >= 1);
});

test('Map attribution removal, theme-toned dark maps, and Huawei/FIT/GPX custom segments work end-to-end', async () => {
  // 4 & 5. Attribution removal & theme-toned dynamic Oscuro maps
  const activityMapSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'ActivityMap.tsx'), 'utf8');
  const multiMapSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'MultiRouteMap.tsx'), 'utf8');
  const cssSource = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'globals.css'), 'utf8');

  assert.ok(activityMapSource.includes('attributionControl: false'));
  assert.ok(multiMapSource.includes('attributionControl: false'));
  assert.ok(cssSource.includes('.leaflet-control-attribution'));
  assert.ok(activityMapSource.includes('buildThemedDarkMapStyle'));
  assert.ok(activityMapSource.includes('MutationObserver'));

  const nocturnoPalette = {
    bg: [12, 14, 25] as [number, number, number],
    surface: [21, 24, 40] as [number, number, number],
    raised: [29, 33, 54] as [number, number, number],
    sunken: [16, 19, 33] as [number, number, number],
    line: [43, 48, 73] as [number, number, number],
    ink: [238, 234, 222] as [number, number, number],
    ink2: [178, 176, 191] as [number, number, number],
    primary: [201, 162, 75] as [number, number, number],
    accent: [212, 175, 94] as [number, number, number],
    accent2: [142, 158, 224] as [number, number, number],
  };
  const bosquePalette = {
    bg: [13, 21, 16] as [number, number, number],
    surface: [22, 34, 26] as [number, number, number],
    raised: [31, 47, 36] as [number, number, number],
    sunken: [17, 27, 20] as [number, number, number],
    line: [45, 68, 52] as [number, number, number],
    ink: [235, 244, 236] as [number, number, number],
    ink2: [175, 196, 180] as [number, number, number],
    primary: [74, 222, 128] as [number, number, number],
    accent: [52, 211, 153] as [number, number, number],
    accent2: [20, 184, 166] as [number, number, number],
  };
  const lightCalidoPalette = {
    bg: [251, 247, 240] as [number, number, number],
    surface: [255, 252, 246] as [number, number, number],
    raised: [255, 255, 255] as [number, number, number],
    sunken: [243, 235, 222] as [number, number, number],
    line: [228, 216, 198] as [number, number, number],
    ink: [36, 28, 20] as [number, number, number],
    ink2: [98, 84, 70] as [number, number, number],
    primary: [194, 65, 12] as [number, number, number],
    accent: [217, 119, 6] as [number, number, number],
    accent2: [13, 148, 136] as [number, number, number],
  };

  const nocturnoColors = resolveDarkMapColors(nocturnoPalette);
  const bosqueColors = resolveDarkMapColors(bosquePalette);
  const calidoLightDarkColors = resolveDarkMapColors(lightCalidoPalette);
  assert.notEqual(nocturnoColors.background, DARK_MAP_BACKGROUND);
  assert.notEqual(nocturnoColors.background, bosqueColors.background);
  assert.notEqual(calidoLightDarkColors.background, bosqueColors.background);

  const nocturnoStyle = buildThemedDarkMapStyle(nocturnoPalette);
  const bosqueStyle = buildThemedDarkMapStyle(bosquePalette);
  assert.equal(nocturnoStyle.layers.length, DARK_MAP_STYLE.layers.length);
  const nocturnoBgLayer = nocturnoStyle.layers.find((l) => l.id === 'background') as { paint?: Record<string, string> };
  const bosqueBgLayer = bosqueStyle.layers.find((l) => l.id === 'background') as { paint?: Record<string, string> };
  assert.equal(nocturnoBgLayer?.paint?.['background-color'], nocturnoColors.background);
  assert.equal(bosqueBgLayer?.paint?.['background-color'], bosqueColors.background);
  // Ensure light theme also yields genuinely dark background luminance (< 55 per channel avg)
  const rCal = parseInt(calidoLightDarkColors.background.slice(1, 3), 16);
  const gCal = parseInt(calidoLightDarkColors.background.slice(3, 5), 16);
  const bCal = parseInt(calidoLightDarkColors.background.slice(5, 7), 16);
  assert.ok((rCal + gCal + bCal) / 3 < 55);

  // 6. Custom segments/laps across Huawei JSON, HiTrack, GPX <trkseg>, FIT, and Health Sync .fit + .tcx fallback
  const huaweiMotionWithSegments = JSON.stringify([
    {
      sportType: 258,
      startTime: 1785200000000,
      partTimeMap: { 0: 120, 400: 110 },
      attribute: 'HW_EXT_TRACK_DETAIL@is\n' +
        'tp=lbs;k=1785200000000000000;lat=43.3600;lon=-5.8500;alt=200;t=1785200000;\n' +
        'tp=lbs;k=1785200300000000000;lat=43.3645;lon=-5.8500;alt=220;t=1785200300;\n' +
        'tp=lbs;k=1785200600000000000;lat=43.3690;lon=-5.8500;alt=250;t=1785200600;\n',
      simplifyJson: JSON.stringify({
        totalTime: 600000,
        totalDistance: 1000,
        partTimeMap: { 1000: 300 },
        segmentList: [
          { name: 'Tramo Llano', startTime: 1785200000000, endTime: 1785200300000, distance: 500, duration: 300, avgHeartRate: 142 },
          { name: 'Rampa Naranco', startTime: 1785200300000, endTime: 1785200600000, distance: 500, duration: 300, avgHeartRate: 165 },
        ],
      }),
    },
  ]).replace('"partTimeMap": { "0": 120, "400": 110 }', '"partTimeMap": { 0: 120, 400: 110 }');

  const parsedHwSegs = parseHuaweiMotionPathJson(huaweiMotionWithSegments, 'motion_path.json');
  assert.equal(parsedHwSegs.length, 1);
  assert.equal(parsedHwSegs[0].laps?.length, 2);
  assert.equal(parsedHwSegs[0].laps?.[0].name, 'Tramo Llano');
  assert.equal(parsedHwSegs[0].laps?.[1].name, 'Rampa Naranco');
  assert.equal(parsedHwSegs[0].laps?.[1].avgHr, 165);
  assert.equal(parsedHwSegs[0].laps?.[0].trigger, 'segment');

  const hiTrackWithSegMarkers = [
    'tp=lbs;k=1785200000000000000;lat=43.3600;lon=-5.8500;alt=200;t=1785200000;',
    'tp=lbs;k=1785200200000000000;lat=43.3630;lon=-5.8500;alt=215;t=1785200200;',
    'tp=seg;k=1785200200000000000;t=1785200200;n=Cambio Ritmo;',
    'tp=lbs;k=1785200400000000000;lat=43.3660;lon=-5.8500;alt=235;t=1785200400;',
  ].join('\n');
  const parsedHiSeg = parseHiTrackText(hiTrackWithSegMarkers);
  assert.equal(parsedHiSeg.laps?.length, 2);
  assert.equal(parsedHiSeg.laps?.[0].name, 'Cambio Ritmo');

  // GPX with multiple <trkseg> creates segment laps
  const multiSegGpx = `<?xml version="1.0" encoding="UTF-8"?>
  <gpx version="1.1">
    <trk>
      <name>Series Oviedo</name>
      <type>running</type>
      <trkseg>
        <trkpt lat="43.3600" lon="-5.8500"><ele>200</ele><time>2026-09-25T08:00:00Z</time></trkpt>
        <trkpt lat="43.3640" lon="-5.8500"><ele>205</ele><time>2026-09-25T08:02:00Z</time></trkpt>
      </trkseg>
      <trkseg>
        <trkpt lat="43.3640" lon="-5.8500"><ele>205</ele><time>2026-09-25T08:03:00Z</time></trkpt>
        <trkpt lat="43.3680" lon="-5.8500"><ele>215</ele><time>2026-09-25T08:05:00Z</time></trkpt>
      </trkseg>
    </trk>
  </gpx>`;
  const parsedMultiSegGpx = parseGpxString(multiSegGpx, 'series.gpx');
  assert.equal(parsedMultiSegGpx.laps?.length, 2);
  assert.equal(parsedMultiSegGpx.laps?.[0].trigger, 'segment');

  // FIT file with manual laps & workout step names
  const encSegFit = new FitEncoder();
  const sFitT0 = new Date('2026-09-26T08:00:00Z');
  const sFitTs = FitEncoder.toFitTimestamp(sFitT0);
  const toSemiSeg = (d: number) => Math.round((d * 2147483648) / 180);
  encSegFit.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
  ], 0);
  encSegFit.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 360 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 1100 * 100 },
  ], 1);
  encSegFit.writeMessage(19, [
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 180 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 180 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 550 * 100 },
    { number: 15, size: 1, baseType: FitBaseType.Uint8, value: 145 },
    { number: 24, size: 1, baseType: FitBaseType.Enum, value: 0 },
  ], 2);
  encSegFit.writeMessage(19, [
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 180 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 180 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 180 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 550 * 100 },
    { number: 15, size: 1, baseType: FitBaseType.Uint8, value: 165 },
    { number: 24, size: 1, baseType: FitBaseType.Enum, value: 0 },
  ], 2);
  encSegFit.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(43.36) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(-5.85) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (200 + 500) * 5 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 135 },
  ], 3);
  encSegFit.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 180 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(43.365) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(-5.85) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (225 + 500) * 5 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 155 },
  ], 3);
  encSegFit.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 360 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(43.37) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(-5.85) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (260 + 500) * 5 },
    { number: 3, size: 1, baseType: FitBaseType.Uint8, value: 170 },
  ], 3);
  const segFitBytes = encSegFit.close();
  const parsedSegFit = await parseFitBuffer(
    Buffer.from(segFitBytes.buffer, segFitBytes.byteOffset, segFitBytes.byteLength),
    '2026.09.26 10.00-RUNNING.fit'
  );
  assert.equal(parsedSegFit.laps?.length, 2);
  assert.equal(parsedSegFit.laps?.[0].name, 'Segmento 1');
  assert.equal(parsedSegFit.laps?.[1].name, 'Segmento 2');
  assert.ok((parsedSegFit.laps?.[0].elevationGain ?? 0) > 0);

  // Health Sync batch fallback: .fit without laps inherits laps from sibling .tcx
  const encNoLapFit = new FitEncoder();
  encNoLapFit.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
  ], 0);
  encNoLapFit.writeMessage(18, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 360 },
    { number: 2, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
    { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
    { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
    { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
    { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 1100 * 100 },
  ], 1);
  encNoLapFit.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(43.36) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(-5.85) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (200 + 500) * 5 },
  ], 2);
  encNoLapFit.writeMessage(20, [
    { number: 253, size: 4, baseType: FitBaseType.Uint32, value: sFitTs + 360 },
    { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(43.37) },
    { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemiSeg(-5.85) },
    { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (240 + 500) * 5 },
  ], 2);
  const noLapFitBytes = encNoLapFit.close();
  const siblingTcx = `<?xml version="1.0" encoding="UTF-8"?>
  <TrainingCenterDatabase>
    <Activities>
      <Activity Sport="Running">
        <Id>2026-09-26T08:00:00Z</Id>
        <Lap StartTime="2026-09-26T08:00:00Z">
          <TotalTimeSeconds>180</TotalTimeSeconds>
          <DistanceMeters>550</DistanceMeters>
          <TriggerMethod>Manual</TriggerMethod>
          <Track>
            <Trackpoint><Time>2026-09-26T08:00:00Z</Time><Position><LatitudeDegrees>43.36</LatitudeDegrees><LongitudeDegrees>-5.85</LongitudeDegrees></Position><AltitudeMeters>200</AltitudeMeters></Trackpoint>
            <Trackpoint><Time>2026-09-26T08:03:00Z</Time><Position><LatitudeDegrees>43.365</LatitudeDegrees><LongitudeDegrees>-5.85</LongitudeDegrees></Position><AltitudeMeters>220</AltitudeMeters></Trackpoint>
          </Track>
        </Lap>
        <Lap StartTime="2026-09-26T08:03:00Z">
          <TotalTimeSeconds>180</TotalTimeSeconds>
          <DistanceMeters>550</DistanceMeters>
          <TriggerMethod>Manual</TriggerMethod>
          <Track>
            <Trackpoint><Time>2026-09-26T08:03:00Z</Time><Position><LatitudeDegrees>43.365</LatitudeDegrees><LongitudeDegrees>-5.85</LongitudeDegrees></Position><AltitudeMeters>220</AltitudeMeters></Trackpoint>
            <Trackpoint><Time>2026-09-26T08:06:00Z</Time><Position><LatitudeDegrees>43.37</LatitudeDegrees><LongitudeDegrees>-5.85</LongitudeDegrees></Position><AltitudeMeters>240</AltitudeMeters></Trackpoint>
          </Track>
        </Lap>
      </Activity>
    </Activities>
  </TrainingCenterDatabase>`;
  const hsBatch = await parseUploadedActivityBatch([
    {
      fileName: '2026.09.26 10.00-RUNNING.fit',
      buffer: Buffer.from(noLapFitBytes.buffer, noLapFitBytes.byteOffset, noLapFitBytes.byteLength),
    },
    { fileName: '2026.09.26 10.00-RUNNING.tcx', buffer: Buffer.from(siblingTcx, 'utf8') },
  ]);
  assert.equal(hsBatch.activities.length, 1);
  assert.equal(hsBatch.activities[0].laps?.length, 2);
  assert.equal(hsBatch.activities[0].laps?.[0].name, 'Segmento 1');
});

test('Settings reload endpoint reprocesses all activities, refreshes sources safely, and discovers/matches segments', async () => {
  const ajustesSource = fs.readFileSync(path.join(process.cwd(), 'src', 'app', 'ajustes', 'page.tsx'), 'utf8');
  const settingsMenuSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'SettingsMenu.tsx'), 'utf8');
  assert.ok(ajustesSource.includes('/api/activities/reload'));
  assert.ok(settingsMenuSource.includes('/api/activities/reload'));

  // Prepare an isolated local Huawei folder in temp dir with a FIT + sibling TCX containing 2 custom laps
  const tmpWatchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bilifit-reload-watch-'));
  try {
    const prevHw = getHuaweiStatus();
    const fitDate = new Date('2026-08-29T07:30:00Z');
    const fitTs = FitEncoder.toFitTimestamp(fitDate);
    const toSemi = (d: number) => Math.round((d * 2147483648) / 180);

    const enc = new FitEncoder();
    enc.writeMessage(0, [
      { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
      { number: 4, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
    ], 0);
    enc.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 360 },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: 1 },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: 360 * 1000 },
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: 1000 * 100 },
    ], 1);
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemi(43.400) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemi(-5.900) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (120 + 500) * 5 },
    ], 2);
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: fitTs + 360 },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: toSemi(43.409) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: toSemi(-5.900) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: (140 + 500) * 5 },
    ], 2);
    const fitBytes = enc.close();
    fs.writeFileSync(
      path.join(tmpWatchDir, '2026.08.29 09.30-RUNNING.fit'),
      Buffer.from(fitBytes.buffer, fitBytes.byteOffset, fitBytes.byteLength)
    );

    // Import first WITHOUT sibling TCX
    updateHuaweiPreferences({ watchDir: tmpWatchDir });
    const firstSync = await syncHuaweiActivities({ mode: 'folder' });
    assert.equal(firstSync.imported, 1);

    const syncedBefore = listActivities({ sport: 'running' }).find((a) => a.startedAt.startsWith('2026-08-29'));
    assert.ok(syncedBefore);
    // Simulate legacy generic title & manual user RPE before reload
    getDb().prepare("UPDATE activities SET title = 'Carrera al aire libre · 29 ago', rpe = 8 WHERE id = ?").run(syncedBefore.id);

    // Now place sibling TCX with 2 manual laps into folder to test source refresh
    const siblingTcx = `<?xml version="1.0" encoding="UTF-8"?>
    <TrainingCenterDatabase>
      <Activities>
        <Activity Sport="Running">
          <Id>2026-08-29T07:30:00Z</Id>
          <Lap StartTime="2026-08-29T07:30:00Z">
            <TotalTimeSeconds>180</TotalTimeSeconds>
            <DistanceMeters>500</DistanceMeters>
            <TriggerMethod>Manual</TriggerMethod>
            <Track>
              <Trackpoint><Time>2026-08-29T07:30:00Z</Time><Position><LatitudeDegrees>43.400</LatitudeDegrees><LongitudeDegrees>-5.900</LongitudeDegrees></Position><AltitudeMeters>120</AltitudeMeters></Trackpoint>
              <Trackpoint><Time>2026-08-29T07:33:00Z</Time><Position><LatitudeDegrees>43.4045</LatitudeDegrees><LongitudeDegrees>-5.900</LongitudeDegrees></Position><AltitudeMeters>130</AltitudeMeters></Trackpoint>
            </Track>
          </Lap>
          <Lap StartTime="2026-08-29T07:33:00Z">
            <TotalTimeSeconds>180</TotalTimeSeconds>
            <DistanceMeters>500</DistanceMeters>
            <TriggerMethod>Manual</TriggerMethod>
            <Track>
              <Trackpoint><Time>2026-08-29T07:33:00Z</Time><Position><LatitudeDegrees>43.4045</LatitudeDegrees><LongitudeDegrees>-5.900</LongitudeDegrees></Position><AltitudeMeters>130</AltitudeMeters></Trackpoint>
              <Trackpoint><Time>2026-08-29T07:36:00Z</Time><Position><LatitudeDegrees>43.409</LatitudeDegrees><LongitudeDegrees>-5.900</LongitudeDegrees></Position><AltitudeMeters>140</AltitudeMeters></Trackpoint>
            </Track>
          </Lap>
        </Activity>
      </Activities>
    </TrainingCenterDatabase>`;
    fs.writeFileSync(path.join(tmpWatchDir, '2026.08.29 09.30-RUNNING.tcx'), siblingTcx, 'utf8');

    // Create two distinct GPS activities climbing the exact same unique hill (far from Naranco seed),
    // with one containing a stationary pause and stale movingTimeSec === durationSec.
    const makeHillPoints = (totalDurSec: number, withPause = false) =>
      Array.from({ length: 15 }, (_, idx) => {
        const paused = withPause && idx >= 5 && idx <= 6;
        const stepIdx = withPause && idx > 6 ? idx - 2 : paused ? 4 : idx;
        const t = Math.round((idx / 14) * totalDurSec);
        const lat = 43.520 + stepIdx * 0.0008;
        const lon = -5.650;
        const ele = idx >= 13 ? 210 - (idx - 12) * 15 : 100 + stepIdx * 9;
        return {
          t,
          lat,
          lon,
          ele,
          hr: 145 + idx,
          speed: paused ? 0 : 2.8,
          dist: stepIdx * 90,
        };
      });

    const climb1Pts = makeHillPoints(700, true);
    const climb2Pts = makeHillPoints(560, false);

    const climbAct1 = createActivity({
      id: 'act_reload_climb_1',
      externalId: null,
      source: 'gpx',
      sport: 'running',
      subSport: 'Correr',
      title: '2026.10.01 09.00-RUNNING.gpx',
      description: null,
      startedAt: '2026-10-01T07:00:00Z',
      durationSec: 700,
      movingTimeSec: 700, // stale: should recover paused interval on reload
      distanceMeters: climb1Pts[climb1Pts.length - 1].dist ?? 1080,
      elevationGain: 100,
      elevationLoss: 20,
      avgSpeedMs: 1.54,
      maxSpeedMs: 3.0,
      avgHr: 152,
      maxHr: 165,
      avgWatts: null,
      normalizedPower: null,
      maxWatts: null,
      avgCadence: 170,
      calories: 140,
      tss: 25,
      rpe: null,
      gearId: null,
      worldName: null,
      polyline: encodePolyline(climb1Pts.map((p) => [p.lat, p.lon])),
      startLat: climb1Pts[0].lat,
      startLon: climb1Pts[0].lon,
      points: climb1Pts,
      strengthLogs: [],
      totalVolumeKg: null,
      laps: [],
      createdAt: '2026-10-01T08:00:00Z',
    });

    const climbAct2 = createActivity({
      id: 'act_reload_climb_2',
      externalId: null,
      source: 'gpx',
      sport: 'running',
      subSport: 'Correr',
      title: 'Subida Somió Rápida',
      description: null,
      startedAt: '2026-10-05T07:00:00Z',
      durationSec: 560,
      movingTimeSec: 560,
      distanceMeters: climb2Pts[climb2Pts.length - 1].dist ?? 1260,
      elevationGain: 110,
      elevationLoss: 25,
      avgSpeedMs: 2.25,
      maxSpeedMs: 3.4,
      avgHr: 162,
      maxHr: 178,
      avgWatts: null,
      normalizedPower: null,
      maxWatts: null,
      avgCadence: 178,
      calories: 135,
      tss: 28,
      rpe: null,
      gearId: null,
      worldName: null,
      polyline: encodePolyline(climb2Pts.map((p) => [p.lat, p.lon])),
      startLat: climb2Pts[0].lat,
      startLon: climb2Pts[0].lon,
      points: climb2Pts,
      strengthLogs: [],
      totalVolumeKg: null,
      laps: [],
      createdAt: '2026-10-05T08:00:00Z',
    });

    // Verify trimmed activity title & trimmed distance stay protected
    const trimmedCustom = getActivityById('act_trim_paused_test');
    assert.ok(trimmedCustom?.trimmed);
    const trimmedDistBefore = trimmedCustom.distanceMeters;

    const countBefore = listActivities().length;

    const reloadRes1 = await postReloadActivitiesRoute(
      new NextRequest('http://localhost:3000/api/activities/reload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reloadSources: true, detectClimbs: true }),
      })
    );
    assert.equal(reloadRes1.status, 200);
    const json1 = (await reloadRes1.json()) as {
      ok: boolean;
      totalActivities: number;
      reprocessedActivities: number;
      sources: { huawei: { status: string; imported: number; updated: number } };
      segments: { before: number; created: number; total: number; effortsMatched: number };
    };

    assert.equal(json1.ok, true);
    assert.equal(json1.totalActivities, countBefore);
    assert.equal(json1.reprocessedActivities, countBefore);
    assert.equal(json1.sources.huawei.status, 'ok');
    assert.equal(json1.sources.huawei.imported, 0);
    assert.equal(json1.sources.huawei.updated, 1);

    // Check Huawei activity refreshed laps, fixed generic title, and kept user RPE=8
    const syncedAfter = getActivityById(syncedBefore.id)!;
    assert.equal(syncedAfter.title, 'Correr · 29 ago 2026');
    assert.equal(syncedAfter.rpe, 8);
    assert.equal(syncedAfter.laps?.length, 2);

    // Check generic GPX title normalized, concrete title preserved, stationary pause recovered
    const climb1After = getActivityById(climbAct1.id)!;
    const climb2After = getActivityById(climbAct2.id)!;
    assert.equal(climb1After.title, 'Correr · 01 oct 2026');
    assert.ok(climb1After.movingTimeSec < climb1After.durationSec);
    assert.equal(climb2After.title, 'Subida Somió Rápida');
    assert.equal(getActivityById('act_trim_paused_test')?.distanceMeters, trimmedDistBefore);

    // Climb discovery creates 1 deduplicated segment for the Somió hill (shared by both climbAct1 & climbAct2)
    assert.ok(json1.segments.created >= 1);
    const somioSegments = listSegments('running').filter(
      (s) => Math.abs(s.startLat - 43.52) < 0.01 && Math.abs(s.startLon - -5.65) < 0.01
    );
    assert.equal(somioSegments.length, 1);
    assert.equal(climb1After.segmentEfforts?.length, 1);
    assert.equal(climb2After.segmentEfforts?.length, 1);
    assert.equal(climb1After.segmentEfforts?.[0].segmentId, somioSegments[0].id);
    assert.equal(climb2After.segmentEfforts?.[0].segmentId, somioSegments[0].id);
    assert.equal(climb2After.segmentEfforts?.[0].prRank, 1);
    assert.equal(climb1After.segmentEfforts?.[0].prRank, 2);

    // Re-running reload a second time is idempotent (no duplicate segments or activities)
    const reloadRes2 = await postReloadActivitiesRoute(
      new NextRequest('http://localhost:3000/api/activities/reload', { method: 'POST' })
    );
    assert.equal(reloadRes2.status, 200);
    const json2 = (await reloadRes2.json()) as typeof json1;
    assert.equal(json2.totalActivities, countBefore);
    assert.equal(json2.segments.created, 0);
    assert.equal(json2.segments.total, json1.segments.total);

    // Account isolation: reloading on pequenaja only affects pequenaja's DB
    const peqReloadRes = await postReloadActivitiesRoute(
      new NextRequest('http://localhost:3000/api/activities/reload', {
        method: 'POST',
        headers: { cookie: `${ACCOUNT_COOKIE_NAME}=pequenaja` },
      })
    );
    assert.equal(peqReloadRes.status, 200);
    const peqJson = (await peqReloadRes.json()) as typeof json1;
    assert.ok(peqJson.totalActivities < json1.totalActivities);

    // Restore watchDir pref
    updateHuaweiPreferences({ watchDir: prevHw.watchDir });
  } finally {
    fs.rmSync(tmpWatchDir, { recursive: true, force: true });
  }
});

test('Telemetry chart pointer mapping syncs accurately and excludePausedTime updates splits, laps, zones, terrain and extras', async () => {
  // 1. Telemetry chart coordinate & index sync (both desktop letterboxing & non-uniform paused points)
  // Desktop wide container (1200x240) with viewBox (780x250) -> scale=0.96, renderedW=748.8, offsetX=225.6
  const leftEdgeSvgX = mapClientXToSvgViewBoxX(225.6 + 44 * 0.96, { left: 0, width: 1200, height: 240 }, 780, 250);
  const rightEdgeSvgX = mapClientXToSvgViewBoxX(225.6 + 764 * 0.96, { left: 0, width: 1200, height: 240 }, 780, 250);
  assert.ok(Math.abs(leftEdgeSvgX - 44) < 0.01);
  assert.ok(Math.abs(rightEdgeSvgX - 764) < 0.01);

  // Build points where first half has 20 points over 1 km (t=0..200) and a 300s pause at km 1.0, then 10 points up to km 2.0 (t=500..700)
  const syncPts = [
    ...Array.from({ length: 20 }, (_, i) => ({
      t: i * 10,
      dist: Math.round((i / 19) * 1000),
      lat: 43.36 + i * 0.0004,
      lon: -5.85,
      ele: 100 + i * 2,
    })),
    ...Array.from({ length: 15 }, (_, i) => ({
      t: 210 + i * 20,
      dist: 1000,
      lat: 43.36 + 19 * 0.0004,
      lon: -5.85,
      ele: 138,
    })),
    ...Array.from({ length: 10 }, (_, i) => ({
      t: 520 + i * 20,
      dist: 1000 + Math.round(((i + 1) / 10) * 1000),
      lat: 43.36 + (20 + i) * 0.0004,
      lon: -5.85,
      ele: 138 + i * 3,
    })),
  ];

  // In distance mode, clicking exactly at 50% of chart width (1.0 km) must resolve to the 1.0 km points, NOT index 50% (which would be fine here, wait: 75% width = 1.5 km must resolve to ~1500m, NOT index 75% which is still at 1000m!)
  const padL = 46;
  const innerW = 900;
  const idxAt75PctDist = resolveTelemetryPointIndexFromSvgX(padL + innerW * 0.75, padL, innerW, syncPts, 'dist');
  assert.ok(Math.abs((syncPts[idxAt75PctDist].dist ?? 0) - 1500) <= 120);

  // In time mode, clicking at 50% of time (350s) must resolve to ~t=350s inside the pause
  const idxAt50PctTime = resolveTelemetryPointIndexFromSvgX(padL + innerW * 0.5, padL, innerW, syncPts, 'time');
  assert.ok(Math.abs(syncPts[idxAt50PctTime].t - 350) <= 25);

  // Non-zero starting dist/t (after start trim): 0% maps to start, 100% maps to end
  const trimmedPts = syncPts.slice(10).map((p) => ({ ...p }));
  assert.equal(resolveTelemetryPointIndexFromSvgX(padL, padL, innerW, trimmedPts, 'dist'), 0);
  assert.equal(resolveTelemetryPointIndexFromSvgX(padL + innerW, padL, innerW, trimmedPts, 'dist'), trimmedPts.length - 1);

  // 2. excludePausedTime updates splits, laps, zones, terrain and extras consistently
  const runPausePoints = [
    // Km 1: 1000m in 300s (all moving, ascending slightly)
    ...Array.from({ length: 61 }, (_, i) => ({
      t: i * 5,
      lat: 43.4 + i * 0.0001495,
      lon: -5.8,
      ele: 100 + i * 0.4,
      hr: 155,
      cad: 174,
      dist: Math.round((i / 60) * 1000),
    })),
    // Km 2: 500m moving (150s), then 180s stopped at source (same lat/lon, lower HR 95 ppm), then 500m moving (150s) => 480s total, 300s moving
    ...Array.from({ length: 30 }, (_, i) => ({
      t: 300 + (i + 1) * 5,
      lat: 43.4 + 60 * 0.0001495 + (i + 1) * 0.0001495,
      lon: -5.8,
      ele: 124 + (i + 1) * 0.5,
      hr: 162,
      cad: 174,
      dist: 1000 + Math.round(((i + 1) / 30) * 500),
    })),
    ...Array.from({ length: 36 }, (_, i) => ({
      t: 450 + (i + 1) * 5,
      lat: 43.4 + 90 * 0.0001495,
      lon: -5.8,
      ele: 139,
      hr: 98,
      cad: 0,
      dist: 1500,
    })),
    ...Array.from({ length: 30 }, (_, i) => ({
      t: 630 + (i + 1) * 5,
      lat: 43.4 + 90 * 0.0001495 + (i + 1) * 0.0001495,
      lon: -5.8,
      ele: 139 - (i + 1) * 0.3,
      hr: 164,
      cad: 176,
      dist: 1500 + Math.round(((i + 1) / 30) * 500),
    })),
  ];

  const pauseAct = createActivity({
    id: 'act_pause_tables_test',
    externalId: null,
    source: 'huawei',
    sport: 'running',
    subSport: 'Correr',
    title: 'Rodaje con Pausa en Fuente',
    description: null,
    startedAt: '2026-10-05T08:00:00Z',
    durationSec: 780,
    movingTimeSec: 600,
    distanceMeters: 2000,
    elevationGain: 45,
    elevationLoss: 15,
    avgSpeedMs: 2.56,
    maxSpeedMs: 3.6,
    avgHr: 145,
    maxHr: 168,
    avgWatts: null,
    normalizedPower: null,
    maxWatts: null,
    avgCadence: 174,
    calories: 150,
    tss: 25,
    rpe: 5,
    gearId: null,
    worldName: null,
    polyline: encodePolyline(runPausePoints.map((p) => [p.lat, p.lon])),
    startLat: runPausePoints[0].lat,
    startLon: runPausePoints[0].lon,
    points: runPausePoints,
    strengthLogs: [],
    totalVolumeKg: null,
    // Deliberately save laps WITHOUT separate movingTimeSec (like Huawei/TCX/FIT exports without auto-pause)
    laps: [
      {
        lapNumber: 1,
        name: 'Vuelta 1',
        startDistM: 0,
        endDistM: 1000,
        distanceMeters: 1000,
        durationSec: 300,
        movingTimeSec: 300,
        avgSpeedMs: 3.33,
        elevationGain: 24,
        elevationLoss: 0,
        trigger: 'auto',
      },
      {
        lapNumber: 2,
        name: 'Vuelta 2',
        startDistM: 1000,
        endDistM: 2000,
        distanceMeters: 1000,
        durationSec: 480,
        movingTimeSec: 480,
        avgSpeedMs: 2.08,
        elevationGain: 15,
        elevationLoss: 9,
        trigger: 'auto',
      },
    ],
    excludePausedTime: false,
    createdAt: new Date().toISOString(),
  });

  // Before excluding paused time: Km 2 & Lap 2 show elapsed speed (~2.08 m/s) and Lap 2 detected movingTimeSec (~300s)
  assert.ok(pauseAct.kmSplits && pauseAct.kmSplits.length >= 2);
  const km2Before = pauseAct.kmSplits[1];
  assert.ok(km2Before.durationSec >= 470);
  assert.ok(km2Before.movingTimeSec <= 320);
  assert.ok((km2Before.avgSpeedMs ?? 0) < 2.3);

  assert.ok(pauseAct.laps && pauseAct.laps.length === 2);
  const lap2Before = pauseAct.laps[1];
  assert.ok(lap2Before.movingTimeSec <= 320, `Lap 2 should detect paused time (${lap2Before.movingTimeSec})`);
  assert.ok((lap2Before.avgSpeedMs ?? 0) < 2.3);

  const terrainBeforeSec = (pauseAct.terrainBreakdown ?? []).reduce((s, t) => s + t.durationSec, 0);
  const hrBeforeSec = (pauseAct.hrZones ?? []).reduce((s, z) => s + z.seconds, 0);
  const z1BeforeSec = pauseAct.hrZones?.[0]?.seconds ?? 0;

  // Toggle excludePausedTime = true via PATCH /api/activities/[id]
  const toggleRes = await patchActivityRoute(
    new NextRequest(`http://localhost:3000/api/activities/${pauseAct.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ excludePausedTime: true }),
    }),
    { params: Promise.resolve({ id: pauseAct.id }) }
  );
  assert.equal(toggleRes.status, 200);
  const toggleJson = (await toggleRes.json()) as { activity: typeof pauseAct };
  const after = toggleJson.activity;
  assert.equal(after.excludePausedTime, true);

  // Km 2 split & Lap 2 speed + GAP + terrain + HR zones must all update!
  const km2After = after.kmSplits![1];
  const lap2After = after.laps![1];
  assert.ok((km2After.avgSpeedMs ?? 0) > (km2Before.avgSpeedMs ?? 0) + 0.8);
  assert.ok((km2After.gapSpeedMs ?? 0) > (km2Before.gapSpeedMs ?? 0) + 0.5);
  assert.ok((lap2After.avgSpeedMs ?? 0) > (lap2Before.avgSpeedMs ?? 0) + 0.8);

  const terrainAfterSec = (after.terrainBreakdown ?? []).reduce((s, t) => s + t.durationSec, 0);
  const hrAfterSec = (after.hrZones ?? []).reduce((s, z) => s + z.seconds, 0);
  const z1AfterSec = after.hrZones?.[0]?.seconds ?? 0;
  assert.ok(terrainAfterSec < terrainBeforeSec - 120);
  assert.ok(hrAfterSec < hrBeforeSec - 120);
  assert.ok(z1AfterSec < z1BeforeSec);
  assert.ok((after.extras?.gapSpeedMs ?? 0) > (pauseAct.extras?.gapSpeedMs ?? 0) + 0.4);
});
