import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import JSZip from 'jszip';
import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';

// Usar una DB temporal aislada durante los tests
const tmpDb = path.join(os.tmpdir(), `bilifit-test-${Date.now()}.db`);
process.env.BILIFIT_DB_PATH = tmpDb;

import {
  calculateCyclingTSS,
  calculateNormalizedPower,
  calculatePMC,
  computePowerCurve,
} from '../src/lib/metrics';
import { decodePolyline, encodePolyline } from '../src/lib/polyline';
import { parseGpxString, generateGpxString } from '../src/lib/parsers/gpx';
import { parseTcxString } from '../src/lib/parsers/tcx';
import { parseUploadedActivityFile } from '../src/lib/parsers';
import {
  DEFAULT_EXERCISES,
  generateHomeRoutine,
  getAlternativeExercises,
  isExerciseCompatible,
} from '../src/lib/home-workouts';
import {
  createActivity,
  createCustomEquipment,
  createSegmentAndMatch,
  getActivityById,
  getAthleteProfile,
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
import { MYWHOOSH_WORLDS, resolveMyWhooshWorldForActivity } from '../src/lib/mywhoosh-maps';
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

test('MyWhoosh virtual worlds resolve by coordinates and title and have SVG assets on disk', () => {
  for (const w of MYWHOOSH_WORLDS) {
    const rel = w.imageUrl.replace(/^\//, '');
    const full = path.join(process.cwd(), 'public', rel);
    assert.ok(fs.existsSync(full), `Missing MyWhoosh SVG map file: ${full}`);
  }

  // Detección por coordenadas dentro del bounding box de Colombia (lat ~4.61, lon ~-72.81)
  const colMatch = resolveMyWhooshWorldForActivity({
    coords: [
      [4.605, -72.825],
      [4.622, -72.801],
    ],
    title: 'Entreno matinal sin nombre de mundo',
  });
  assert.equal(colMatch?.world.id, 'colombia');

  // Detección por nombre de ruta/título
  const arabiaMatch = resolveMyWhooshWorldForActivity({
    title: 'Subida dura a Jebel Jais',
  });
  assert.equal(arabiaMatch?.world.id, 'arabia');
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
