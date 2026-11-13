import { computeSessionExtras, enrichPointsTelemetry } from '@/lib/analytics';
import { getMyWhooshWorldByIdOrName } from '@/lib/mywhoosh-maps';
import { encodePolyline } from '@/lib/polyline';
import { calculateNormalizedPower, estimateActivityTSS } from '@/lib/metrics';
import { DEFAULT_HOME_EQUIPMENT } from '@/lib/home-workouts';
import type { ActivityPoint, AthleteProfile, GearItem, MountainRoute, Routine, SportType, StrengthSetLog } from '@/types';

function daysAgoIso(daysAgo: number, hour = 8, minute = 30): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

/**
 * Genera una traza GPS sintética realista alrededor de unas coordenadas reales
 * (p. ej. Monte Naranco en Oviedo, Lagos de Covadonga o Sierra del Sueve).
 */
function buildGpsLoop(
  centerLat: number,
  centerLon: number,
  radiusLat: number,
  radiusLon: number,
  baseEle: number,
  peakClimb: number,
  durationSec: number,
  sampleCount: number,
  baseHr: number,
  baseSpeedMs: number
): { points: ActivityPoint[]; polyline: string; distanceMeters: number; gain: number; loss: number } {
  const points: ActivityPoint[] = [];
  const coords: Array<[number, number]> = [];
  let cumDist = 0;

  for (let i = 0; i < sampleCount; i++) {
    const progress = i / (sampleCount - 1);
    const angle = progress * Math.PI * 2;
    // Forma orgánica de sendero de montaña / circuito
    const wobble = Math.sin(angle * 3) * 0.18 + Math.cos(angle * 5) * 0.08;
    const lat = centerLat + Math.sin(angle) * radiusLat * (1 + wobble);
    const lon = centerLon + Math.cos(angle) * radiusLon * (1 - wobble * 0.7);

    // Perfil con subida principal + repecho final
    const eleWave =
      Math.sin(progress * Math.PI) * peakClimb +
      Math.sin(progress * Math.PI * 3) * (peakClimb * 0.14);
    const ele = Math.round((baseEle + Math.max(0, eleWave)) * 10) / 10;

    if (i > 0) {
      const prev = points[i - 1];
      const dLat = (lat - (prev.lat ?? lat)) * 111320;
      const dLon = (lon - (prev.lon ?? lon)) * 111320 * Math.cos((lat * Math.PI) / 180);
      cumDist += Math.sqrt(dLat * dLat + dLon * dLon);
    }

    const slopeEffect = i > 0 ? ((ele - (points[i - 1].ele ?? ele)) > 0 ? 12 : -6) : 0;
    const hr = Math.round(
      Math.min(186, Math.max(118, baseHr + Math.sin(progress * Math.PI * 2.5) * 9 + slopeEffect))
    );
    const speed = Math.round(Math.max(1.1, baseSpeedMs - slopeEffect * 0.05) * 100) / 100;

    points.push({
      t: Math.round(progress * durationSec),
      lat: Math.round(lat * 1e6) / 1e6,
      lon: Math.round(lon * 1e6) / 1e6,
      ele,
      hr,
      cad: Math.round(166 + Math.sin(progress * 10) * 6),
      speed,
      dist: Math.round(cumDist),
    });
    coords.push([lat, lon]);
  }

  // Calcular desnivel
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const diff = (points[i].ele ?? 0) - (points[i - 1].ele ?? 0);
    if (diff > 0) gain += diff;
    else loss += Math.abs(diff);
  }

  return {
    points,
    polyline: encodePolyline(coords),
    distanceMeters: Math.round(cumDist),
    gain: Math.round(gain),
    loss: Math.round(loss),
  };
}

/**
 * Genera telemetría realista de una sesión en MyWhoosh (intervalos / puertos / tempo)
 * con coordenadas GPS reales dentro del mundo correspondiente para dibujar el mapa virtual.
 */
function buildMyWhooshTelemetry(
  durationSec: number,
  targetAvgWatts: number,
  mode: 'sweetspot' | 'vo2' | 'endurance' | 'climb',
  baseHr: number,
  worldName = 'Hudayriyat'
): { points: ActivityPoint[]; polyline: string } {
  const sampleCount = 120;
  const points: ActivityPoint[] = [];
  const coords: Array<[number, number]> = [];
  let cumDist = 0;
  let ele = 12;

  const world = getMyWhooshWorldByIdOrName(worldName);
  const [[sLat, wLon], [nLat, eLon]] = world?.bounds ?? [
    [23.332, 54.955],
    [23.382, 54.998],
  ];
  const centerLat = (sLat + nLat) / 2;
  const centerLon = (wLon + eLon) / 2;
  const radLat = (nLat - sLat) * 0.28;
  const radLon = (eLon - wLon) * 0.28;

  for (let i = 0; i < sampleCount; i++) {
    const p = i / (sampleCount - 1);
    const t = Math.round(p * durationSec);
    const angle = p * Math.PI * 2;
    const wobble = Math.sin(angle * 3) * 0.16;
    const lat = Math.round((centerLat + Math.sin(angle) * radLat * (1 + wobble)) * 1e6) / 1e6;
    const lon = Math.round((centerLon + Math.cos(angle) * radLon * (1 - wobble * 0.6)) * 1e6) / 1e6;
    coords.push([lat, lon]);

    let watts = targetAvgWatts;

    if (p < 0.12) {
      watts = Math.round(targetAvgWatts * (0.55 + (p / 0.12) * 0.35));
    } else if (p > 0.9) {
      watts = Math.round(targetAvgWatts * 0.58);
    } else if (mode === 'vo2') {
      const block = Math.floor(((p - 0.12) / 0.78) * 10);
      watts = block % 2 === 0 ? Math.round(targetAvgWatts * 1.24) : Math.round(targetAvgWatts * 0.62);
    } else if (mode === 'sweetspot') {
      const block = Math.floor(((p - 0.12) / 0.78) * 6);
      watts = block % 2 === 0 ? Math.round(targetAvgWatts * 1.07) : Math.round(targetAvgWatts * 0.72);
    } else if (mode === 'climb') {
      watts = Math.round(targetAvgWatts * (0.95 + Math.sin(p * Math.PI * 2) * 0.15));
      ele = Math.round((12 + Math.sin(p * Math.PI) * 680) * 10) / 10;
    } else {
      watts = Math.round(targetAvgWatts + Math.sin(p * 18) * 18);
      ele = Math.round((18 + Math.sin(p * Math.PI * 2) * 28) * 10) / 10;
    }

    const speed = Math.round((6.5 + (watts / 250) * 4.2 - (mode === 'climb' ? 2.4 : 0)) * 100) / 100;
    if (i > 0) {
      const dt = durationSec / (sampleCount - 1);
      cumDist += speed * dt;
    }

    const hr = Math.round(Math.min(185, Math.max(108, baseHr + (watts - targetAvgWatts) * 0.22 + p * 10)));
    const cad = Math.round(watts > targetAvgWatts * 1.1 ? 94 : mode === 'climb' ? 78 : 88 + Math.sin(p * 12) * 3);

    points.push({
      t,
      lat,
      lon,
      ele,
      watts,
      hr,
      cad,
      speed,
      dist: Math.round(cumDist),
      temp: 22,
    });
  }

  return {
    points: enrichPointsTelemetry(points, 'mywhoosh'),
    polyline: encodePolyline(coords),
  };
}

export const SEED_PROFILE: AthleteProfile = {
  name: 'Raúl',
  weightKg: 72,
  ftpWatts: 245,
  maxHr: 190,
  restingHr: 50,
  lthr: 169,
  weeklyTargetHours: 8,
  weeklyTargetKm: 55,
};

export const SEED_GEAR: GearItem[] = [
  {
    id: 'gear_road_shoes',
    name: 'Zapatillas Asfalto (Pegasus / Tempo)',
    brand: 'Nike',
    category: 'running_shoes',
    defaultForSport: 'running',
    initialKm: 210,
    trackedKm: 0,
    maxKm: 750,
    active: true,
    notes: 'Rodajes diarios y series en asfalto',
  },
  {
    id: 'gear_trail_shoes',
    name: 'Zapatillas Trail Montaña',
    brand: 'Salomon / Hoka',
    category: 'trail_shoes',
    defaultForSport: 'trail',
    initialKm: 145,
    trackedKm: 0,
    maxKm: 650,
    active: true,
    notes: 'Taco agresivo para terreno húmedo y roca',
  },
  {
    id: 'gear_trainer_bike',
    name: 'Bici Carretera + Rodillo Smart (MyWhoosh)',
    brand: 'Orbea / Wahoo',
    category: 'indoor_trainer',
    defaultForSport: 'mywhoosh',
    initialKm: 1240,
    trackedKm: 0,
    maxKm: 5000,
    active: true,
    notes: 'Cadena revisada cada 2.500 km',
  },
];

export const SEED_ROUTES: MountainRoute[] = [
  {
    id: 'route_naranco',
    name: 'Integral Monte Naranco por senderos',
    region: 'Oviedo · Asturias',
    difficulty: 'Moderada',
    sport: 'mountain',
    ...(() => {
      const loop = buildGpsLoop(43.385, -5.868, 0.018, 0.024, 210, 420, 4800, 90, 148, 2.5);
      return {
        distanceMeters: loop.distanceMeters,
        elevationGain: loop.gain,
        elevationLoss: loop.loss,
        maxEle: 634,
        minEle: 210,
        estimatedTimeSec: 5400,
        polyline: loop.polyline,
        points: loop.points,
      };
    })(),
    status: 'completed',
    notes: 'Subida por pista forestal hasta el Cristo y bajada técnica por sendero norte.',
    createdAt: daysAgoIso(25),
  },
  {
    id: 'route_pienzu',
    name: 'Ascensión al Picu Pienzu (Sierra del Sueve)',
    region: 'Mirador del Fito · Asturias',
    difficulty: 'Exigente',
    sport: 'mountain',
    ...(() => {
      const loop = buildGpsLoop(43.462, -5.228, 0.022, 0.028, 595, 570, 7200, 100, 142, 1.9);
      return {
        distanceMeters: loop.distanceMeters,
        elevationGain: loop.gain,
        elevationLoss: loop.loss,
        maxEle: 1161,
        minEle: 595,
        estimatedTimeSec: 8400,
        polyline: loop.polyline,
        points: loop.points,
      };
    })(),
    status: 'pending',
    notes: 'Llevar cortavientos para la cima y agua (fuente en Majada de Bustacu).',
    createdAt: daysAgoIso(10),
  },
  {
    id: 'route_lagos',
    name: 'Circular Lagos de Covadonga y Ordiales',
    region: 'Picos de Europa',
    difficulty: 'Alta Montaña',
    sport: 'mountain',
    ...(() => {
      const loop = buildGpsLoop(43.268, -4.989, 0.028, 0.035, 1070, 740, 12600, 110, 138, 1.6);
      return {
        distanceMeters: loop.distanceMeters,
        elevationGain: loop.gain,
        elevationLoss: loop.loss,
        maxEle: 1750,
        minEle: 1070,
        estimatedTimeSec: 14400,
        polyline: loop.polyline,
        points: loop.points,
      };
    })(),
    status: 'pending',
    notes: 'Terreno calizo técnico; revisar previsión meteorológica antes de salir.',
    createdAt: daysAgoIso(4),
  },
];

export const PRESET_5DAY_ROUTINES: Routine[] = [
  {
    id: 'routine_push_a_day1',
    name: 'Día 1 – Empuje A',
    goal: 'tren_superior',
    level: 'intermedio',
    estimatedMinutes: 55,
    equipmentIds: ['barbell', 'bench', 'dumbbells', 'cable'],
    items: [
      {
        exerciseId: 'ex_bb_bench_press',
        exerciseName: 'Press de banca con barra',
        muscleGroup: 'pecho',
        requiredEquipment: ['barbell', 'bench'],
        sets: 4,
        reps: '6-8',
        restSeconds: 120,
        notes: 'Músculos: Pectoral mayor, tríceps y deltoides anterior.',
      },
      {
        exerciseId: 'ex_db_incline_press',
        exerciseName: 'Press inclinado con mancuernas',
        muscleGroup: 'pecho',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 3,
        reps: '8-10',
        restSeconds: 90,
        notes: 'Músculos: Pectoral mayor (porción superior), deltoides anterior y tríceps.',
      },
      {
        exerciseId: 'ex_db_chest_fly',
        exerciseName: 'Aperturas con mancuernas',
        muscleGroup: 'pecho',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 3,
        reps: '12-15',
        restSeconds: 75,
        notes: 'Músculos: Pectoral mayor (aislamiento).',
      },
      {
        exerciseId: 'ex_db_seated_shoulder_press',
        exerciseName: 'Press militar sentado',
        muscleGroup: 'hombros',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 4,
        reps: '8-10',
        restSeconds: 90,
        notes: 'Músculos: Deltoides anterior, deltoides lateral y tríceps.',
      },
      {
        exerciseId: 'ex_db_lateral_raise',
        exerciseName: 'Elevaciones laterales',
        muscleGroup: 'hombros',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '12-15',
        restSeconds: 60,
        notes: 'Músculos: Deltoides lateral (aislamiento).',
      },
      {
        exerciseId: 'ex_cable_triceps_pushdown',
        exerciseName: 'Extensión de tríceps en polea',
        muscleGroup: 'brazos',
        requiredEquipment: ['cable'],
        sets: 3,
        reps: '12',
        restSeconds: 60,
        notes: 'Músculos: Tríceps (cabeza lateral y medial).',
      },
      {
        exerciseId: 'ex_close_grip_pushup',
        exerciseName: 'Flexiones agarre cerrado',
        muscleGroup: 'brazos',
        requiredEquipment: [],
        sets: 3,
        reps: 'Al fallo técnico',
        restSeconds: 75,
        notes: 'Músculos: Tríceps, pectoral menor y deltoides anterior.',
      },
    ],
    notes: 'Pecho, hombro y tríceps · RIR 1-2 · Descansa 60–120 seg entre series. Peso manual cada día.',
    timesCompleted: 0,
    lastCompletedAt: null,
    createdAt: daysAgoIso(1, 9, 5),
  },
  {
    id: 'routine_pull_a_day2',
    name: 'Día 2 – Tirón A',
    goal: 'tren_superior',
    level: 'intermedio',
    estimatedMinutes: 55,
    equipmentIds: ['pullup_bar', 'barbell', 'dumbbells', 'cable'],
    items: [
      {
        exerciseId: 'ex_pullups',
        exerciseName: 'Dominadas (pronación)',
        muscleGroup: 'espalda',
        requiredEquipment: ['pullup_bar'],
        sets: 4,
        reps: 'Al fallo técnico',
        restSeconds: 120,
        notes: 'Músculos: Dorsal ancho, bíceps, romboides y trapecio.',
      },
      {
        exerciseId: 'ex_bb_row',
        exerciseName: 'Remo con barra',
        muscleGroup: 'espalda',
        requiredEquipment: ['barbell'],
        sets: 4,
        reps: '8',
        restSeconds: 120,
        notes: 'Músculos: Dorsal ancho, romboides, trapecio medio y bíceps.',
      },
      {
        exerciseId: 'ex_db_one_arm_row',
        exerciseName: 'Remo unilateral con mancuerna',
        muscleGroup: 'espalda',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '10 por lado',
        restSeconds: 90,
        notes: 'Músculos: Dorsal ancho, romboides, trapecio medio y bíceps.',
      },
      {
        exerciseId: 'ex_cable_lat_pulldown',
        exerciseName: 'Jalón en polea (al pecho)',
        muscleGroup: 'espalda',
        requiredEquipment: ['cable'],
        sets: 3,
        reps: '12',
        restSeconds: 90,
        notes: 'Músculos: Dorsal ancho, bíceps y trapecio inferior.',
      },
      {
        exerciseId: 'ex_db_rear_delt_fly',
        exerciseName: 'Pájaros con mancuernas',
        muscleGroup: 'hombros',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '15',
        restSeconds: 60,
        notes: 'Músculos: Deltoides posterior, romboides y trapecio medio.',
      },
      {
        exerciseId: 'ex_bb_bicep_curl',
        exerciseName: 'Curl con barra (recta)',
        muscleGroup: 'brazos',
        requiredEquipment: ['barbell'],
        sets: 3,
        reps: '8-10',
        restSeconds: 75,
        notes: 'Músculos: Bíceps braquial (cabeza larga y corta).',
      },
      {
        exerciseId: 'ex_db_hammer_curl_strict',
        exerciseName: 'Curl martillo con mancuernas',
        muscleGroup: 'brazos',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '10-12',
        restSeconds: 60,
        notes: 'Músculos: Bíceps braquial, braquial anterior y braquiorradial.',
      },
    ],
    notes: 'Espalda, bíceps y deltoides posterior · RIR 1-2 · Descansa 60–120 seg entre series. Peso manual cada día.',
    timesCompleted: 0,
    lastCompletedAt: null,
    createdAt: daysAgoIso(1, 9, 4),
  },
  {
    id: 'routine_legs_a_day3',
    name: 'Día 3 – Pierna A (Cuádriceps) + Core',
    goal: 'tren_inferior',
    level: 'intermedio',
    estimatedMinutes: 50,
    equipmentIds: ['barbell', 'dumbbells', 'pullup_bar', 'mat'],
    items: [
      {
        exerciseId: 'ex_bb_squat',
        exerciseName: 'Sentadilla con barra',
        muscleGroup: 'piernas',
        requiredEquipment: ['barbell'],
        sets: 4,
        reps: '8',
        restSeconds: 120,
        notes: 'Músculos: Cuádriceps, glúteos, isquiotibiales y core.',
      },
      {
        exerciseId: 'ex_db_bulgarian_split',
        exerciseName: 'Sentadilla búlgara con mancuernas',
        muscleGroup: 'piernas',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '10 por pierna',
        restSeconds: 90,
        notes: 'Músculos: Cuádriceps, glúteos e isquiotibiales.',
      },
      {
        exerciseId: 'ex_db_walking_lunges',
        exerciseName: 'Zancadas caminando con mancuernas',
        muscleGroup: 'piernas',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '10-12 por pierna',
        restSeconds: 90,
        notes: 'Músculos: Cuádriceps, glúteos e isquiotibiales.',
      },
      {
        exerciseId: 'ex_standing_calf_raise',
        exerciseName: 'Elevaciones de gemelos (de pie)',
        muscleGroup: 'piernas',
        requiredEquipment: [],
        sets: 5,
        reps: '15-20',
        restSeconds: 60,
        notes: 'Músculos: Gemelos (gastrocnemio y sóleo). Carga corporal o con mancuerna.',
      },
      {
        exerciseId: 'ex_hanging_knee_raise',
        exerciseName: 'Elevación de piernas colgado',
        muscleGroup: 'core',
        requiredEquipment: ['pullup_bar'],
        sets: 3,
        reps: '15',
        restSeconds: 60,
        notes: 'Músculos: Abdominales inferiores y flexores de cadera.',
      },
      {
        exerciseId: 'ex_plate_russian_twist',
        exerciseName: 'Russian twist con disco',
        muscleGroup: 'core',
        requiredEquipment: ['barbell', 'mat'],
        sets: 3,
        reps: '20 (total)',
        restSeconds: 60,
        notes: 'Músculos: Oblicuos y transverso abdominal.',
      },
    ],
    notes: 'Cuádriceps, glúteos, gemelos y core · RIR 1-2 · Descansa 60–120 seg entre series. Peso manual cada día.',
    timesCompleted: 0,
    lastCompletedAt: null,
    createdAt: daysAgoIso(1, 9, 3),
  },
  {
    id: 'routine_push_b_day5',
    name: 'Día 5 – Empuje B + Core',
    goal: 'tren_superior',
    level: 'intermedio',
    estimatedMinutes: 55,
    equipmentIds: ['barbell', 'bench', 'dumbbells', 'cable', 'mat'],
    items: [
      {
        exerciseId: 'ex_bb_bench_press',
        exerciseName: 'Press de banca con barra',
        muscleGroup: 'pecho',
        requiredEquipment: ['barbell', 'bench'],
        sets: 4,
        reps: '6-8',
        restSeconds: 120,
        notes: 'Músculos: Pectoral mayor, tríceps y deltoides anterior.',
      },
      {
        exerciseId: 'ex_db_incline_press',
        exerciseName: 'Press inclinado con mancuernas',
        muscleGroup: 'pecho',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 3,
        reps: '8-10',
        restSeconds: 90,
        notes: 'Músculos: Pectoral mayor (porción superior), deltoides anterior y tríceps.',
      },
      {
        exerciseId: 'ex_db_chest_fly',
        exerciseName: 'Aperturas con mancuernas',
        muscleGroup: 'pecho',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 3,
        reps: '12-15',
        restSeconds: 75,
        notes: 'Músculos: Pectoral mayor (aislamiento).',
      },
      {
        exerciseId: 'ex_ez_skullcrusher',
        exerciseName: 'Press francés con barra Z',
        muscleGroup: 'brazos',
        requiredEquipment: ['barbell', 'bench'],
        sets: 3,
        reps: '10-12',
        restSeconds: 75,
        notes: 'Músculos: Tríceps (cabeza larga).',
      },
      {
        exerciseId: 'ex_cable_triceps_pushdown',
        exerciseName: 'Extensión de tríceps en polea',
        muscleGroup: 'brazos',
        requiredEquipment: ['cable'],
        sets: 3,
        reps: '10-12',
        restSeconds: 60,
        notes: 'Músculos: Tríceps (cabeza lateral y medial).',
      },
      {
        exerciseId: 'ex_weighted_plank',
        exerciseName: 'Plancha con peso en la espalda',
        muscleGroup: 'core',
        requiredEquipment: ['mat', 'barbell'],
        sets: 3,
        reps: '45-60 seg',
        restSeconds: 60,
        notes: 'Músculos: Core (estabilidad global) y transverso abdominal.',
      },
      {
        exerciseId: 'ex_plate_crunch',
        exerciseName: 'Crunch con disco',
        muscleGroup: 'core',
        requiredEquipment: ['mat', 'barbell'],
        sets: 3,
        reps: '15-20',
        restSeconds: 60,
        notes: 'Músculos: Recto del abdomen.',
      },
    ],
    notes: 'Pecho, tríceps y core · RIR 1-2 · Descansa 60–120 seg entre series. Peso manual cada día.',
    timesCompleted: 0,
    lastCompletedAt: null,
    createdAt: daysAgoIso(1, 9, 2),
  },
  {
    id: 'routine_pull_b_day6',
    name: 'Día 6 – Tirón B + Cadena Posterior',
    goal: 'fuerza_general',
    level: 'intermedio',
    estimatedMinutes: 65,
    equipmentIds: ['barbell', 'bench', 'pullup_bar', 'dumbbells', 'mat'],
    items: [
      {
        exerciseId: 'ex_bb_rdl',
        exerciseName: 'Peso muerto rumano',
        muscleGroup: 'piernas',
        requiredEquipment: ['barbell'],
        sets: 4,
        reps: '6-8',
        restSeconds: 120,
        notes: 'Músculos: Isquiotibiales, glúteos y erectores espinales.',
      },
      {
        exerciseId: 'ex_bb_hip_thrust',
        exerciseName: 'Hip Thrust con barra',
        muscleGroup: 'piernas',
        requiredEquipment: ['barbell', 'bench'],
        sets: 3,
        reps: '8-10',
        restSeconds: 90,
        notes: 'Músculos: Glúteos (máximo) e isquiotibiales.',
      },
      {
        exerciseId: 'ex_bb_good_morning',
        exerciseName: 'Buenos días con barra',
        muscleGroup: 'piernas',
        requiredEquipment: ['barbell'],
        sets: 3,
        reps: '10-12',
        restSeconds: 90,
        notes: 'Músculos: Isquiotibiales, glúteos y erectores espinales.',
      },
      {
        exerciseId: 'ex_pullups',
        exerciseName: 'Dominadas (pronación)',
        muscleGroup: 'espalda',
        requiredEquipment: ['pullup_bar'],
        sets: 3,
        reps: '6-10',
        restSeconds: 120,
        notes: 'Músculos: Dorsal ancho, bíceps y romboides.',
      },
      {
        exerciseId: 'ex_bb_row',
        exerciseName: 'Remo con barra',
        muscleGroup: 'espalda',
        requiredEquipment: ['barbell'],
        sets: 3,
        reps: '8-10',
        restSeconds: 90,
        notes: 'Músculos: Dorsal ancho, romboides, trapecio medio y bíceps.',
      },
      {
        exerciseId: 'ex_db_rear_delt_fly',
        exerciseName: 'Pájaros con mancuernas',
        muscleGroup: 'hombros',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '12-15',
        restSeconds: 60,
        notes: 'Músculos: Deltoides posterior y romboides.',
      },
      {
        exerciseId: 'ex_db_incline_curl',
        exerciseName: 'Curl inclinado con mancuernas',
        muscleGroup: 'brazos',
        requiredEquipment: ['dumbbells', 'bench'],
        sets: 3,
        reps: '10-12',
        restSeconds: 60,
        notes: 'Músculos: Bíceps braquial (cabeza larga).',
      },
      {
        exerciseId: 'ex_standing_calf_raise',
        exerciseName: 'Elevaciones de gemelos (de pie)',
        muscleGroup: 'piernas',
        requiredEquipment: [],
        sets: 4,
        reps: '15-20',
        restSeconds: 60,
        notes: 'Músculos: Gemelos (gastrocnemio y sóleo). Carga corporal o con mancuerna.',
      },
      {
        exerciseId: 'ex_side_plank',
        exerciseName: 'Plancha lateral',
        muscleGroup: 'core',
        requiredEquipment: ['mat'],
        sets: 3,
        reps: '30-45 seg por lado',
        restSeconds: 60,
        notes: 'Músculos: Oblicuos, transverso abdominal y core (estabilidad).',
      },
    ],
    notes: 'Isquiotibiales, glúteos, espalda, bíceps, gemelos y core · RIR 1-2 · Descansa 60–120 seg entre series. Peso manual cada día.',
    timesCompleted: 0,
    lastCompletedAt: null,
    createdAt: daysAgoIso(1, 9, 1),
  },
];

export const SEED_ROUTINES: Routine[] = [
  ...PRESET_5DAY_ROUTINES,
  {
    id: 'routine_trail_power',
    name: 'Fuerza y Estabilidad para Correr & Montaña',
    goal: 'correr_montana',
    level: 'intermedio',
    estimatedMinutes: 35,
    equipmentIds: ['mat', 'dumbbells', 'bands'],
    items: [
      {
        exerciseId: 'ex_band_monster_walk',
        exerciseName: 'Caminata lateral con mini-band (Monster Walk)',
        muscleGroup: 'piernas',
        requiredEquipment: ['bands'],
        sets: 3,
        reps: '15 pasos c/lado',
        restSeconds: 40,
      },
      {
        exerciseId: 'ex_db_bulgarian_split',
        exerciseName: 'Sentadilla búlgara con mancuernas',
        muscleGroup: 'piernas',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '8-10 por pierna',
        suggestedWeightKg: 10,
        restSeconds: 75,
      },
      {
        exerciseId: 'ex_db_single_leg_rdl',
        exerciseName: 'Peso muerto a una pierna con mancuerna',
        muscleGroup: 'piernas',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '8-10 por pierna',
        suggestedWeightKg: 12,
        restSeconds: 60,
      },
      {
        exerciseId: 'ex_nordic_eccentric_calf',
        exerciseName: 'Elevaciones excéntricas de gemelo y sóleo',
        muscleGroup: 'piernas',
        requiredEquipment: [],
        sets: 3,
        reps: '15 por pierna',
        restSeconds: 45,
      },
      {
        exerciseId: 'ex_side_plank_clam',
        exerciseName: 'Plancha lateral + abducción de cadera',
        muscleGroup: 'core',
        requiredEquipment: ['mat'],
        sets: 3,
        reps: '10 por lado',
        restSeconds: 45,
      },
    ],
    notes: 'Rutina de prevención y fuerza excéntrica para subidas y bajadas técnicas.',
    timesCompleted: 4,
    lastCompletedAt: daysAgoIso(3, 19, 15),
    createdAt: daysAgoIso(35),
  },
  {
    id: 'routine_mywhoosh_comp',
    name: 'Core, Espalda y Bisagra Post-MyWhoosh',
    goal: 'ciclismo_mywhoosh',
    level: 'intermedio',
    estimatedMinutes: 30,
    equipmentIds: ['mat', 'dumbbells', 'bands', 'roller_foam'],
    items: [
      {
        exerciseId: 'ex_foam_thoracic_ext',
        exerciseName: 'Extensión torácica sobre Foam Roller',
        muscleGroup: 'movilidad',
        requiredEquipment: ['roller_foam', 'mat'],
        sets: 2,
        reps: '10 respiraciones',
        restSeconds: 30,
      },
      {
        exerciseId: 'ex_db_rdl',
        exerciseName: 'Peso muerto rumano con mancuernas',
        muscleGroup: 'piernas',
        requiredEquipment: ['dumbbells'],
        sets: 3,
        reps: '10-12',
        suggestedWeightKg: 16,
        restSeconds: 75,
      },
      {
        exerciseId: 'ex_band_face_pull',
        exerciseName: 'Face Pull con banda elástica',
        muscleGroup: 'espalda',
        requiredEquipment: ['bands'],
        sets: 3,
        reps: '15-20',
        restSeconds: 45,
      },
      {
        exerciseId: 'ex_deadbug',
        exerciseName: 'Dead Bug (bicho muerto) controlado',
        muscleGroup: 'core',
        requiredEquipment: ['mat'],
        sets: 3,
        reps: '12 alternas',
        restSeconds: 45,
      },
      {
        exerciseId: 'ex_band_pallof_press',
        exerciseName: 'Pallof Press anti-rotación con banda',
        muscleGroup: 'core',
        requiredEquipment: ['bands'],
        sets: 3,
        reps: '10 por lado',
        restSeconds: 45,
      },
    ],
    notes: 'Ideal para compensar la postura del rodillo y mantener potencia estable en el sillín.',
    timesCompleted: 3,
    lastCompletedAt: daysAgoIso(7, 19, 45),
    createdAt: daysAgoIso(30),
  },
];

export interface SeedActivitySpec {
  id: string;
  source: 'strava' | 'gpx' | 'fit' | 'bilifit_home';
  sport: SportType;
  subSport: string;
  title: string;
  description: string;
  daysAgo: number;
  hour: number;
  durationSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  avgHr?: number;
  maxHr?: number;
  avgWatts?: number;
  maxWatts?: number;
  avgCadence?: number;
  rpe?: number;
  gearId?: string;
  worldName?: string;
  points: ActivityPoint[];
  polyline?: string;
  strengthLogs?: StrengthSetLog[];
  totalVolumeKg?: number;
}

export function buildSeedActivities(): SeedActivitySpec[] {
  const list: SeedActivitySpec[] = [];

  // 1. MyWhoosh Sweet Spot reciente (hace 1 día)
  const mw1 = buildMyWhooshTelemetry(3300, 218, 'sweetspot', 152, 'Hudayriyat');
  list.push({
    id: 'act_seed_mw_1',
    source: 'strava',
    sport: 'mywhoosh',
    subSport: 'MyWhoosh Indoor',
    title: 'MyWhoosh · Hudayriyat Sweet Spot 3x10m',
    description: 'Bloques al 90-95% FTP en Hudayriyat Island. Muy buenas sensaciones de cadencia.',
    daysAgo: 1,
    hour: 18,
    durationSec: 3300,
    distanceMeters: mw1.points[mw1.points.length - 1].dist ?? 34200,
    elevationGain: 145,
    elevationLoss: 145,
    avgHr: 151,
    maxHr: 172,
    avgWatts: 218,
    maxWatts: 312,
    avgCadence: 89,
    rpe: 7,
    gearId: 'gear_trainer_bike',
    worldName: 'Hudayriyat',
    points: mw1.points,
    polyline: mw1.polyline,
  });

  // 2. Trail Montaña Naranco (hace 2 días)
  const tr1 = buildGpsLoop(43.385, -5.868, 0.017, 0.022, 210, 420, 4680, 90, 154, 2.75);
  list.push({
    id: 'act_seed_mtn_1',
    source: 'gpx',
    sport: 'trail',
    subSport: 'Trail Running',
    title: 'Trail Monte Naranco y Sendero Norte',
    description: 'Subida continua hasta el Pico Paisano y bajada divertida por sendero embarrado.',
    daysAgo: 2,
    hour: 9,
    durationSec: 4680,
    distanceMeters: tr1.distanceMeters,
    elevationGain: tr1.gain,
    elevationLoss: tr1.loss,
    avgHr: 155,
    maxHr: 179,
    avgCadence: 164,
    rpe: 8,
    gearId: 'gear_trail_shoes',
    points: enrichPointsTelemetry(tr1.points, 'trail'),
    polyline: tr1.polyline,
  });

  // 3. Fuerza en Casa (hace 3 días)
  const strengthLogs1: StrengthSetLog[] = [
    {
      exerciseId: 'ex_db_bulgarian_split',
      exerciseName: 'Sentadilla búlgara con mancuernas',
      equipmentUsed: ['dumbbells'],
      sets: [
        { reps: 10, weightKg: 20, completed: true },
        { reps: 10, weightKg: 20, completed: true },
        { reps: 10, weightKg: 20, completed: true },
      ],
    },
    {
      exerciseId: 'ex_db_single_leg_rdl',
      exerciseName: 'Peso muerto a una pierna con mancuerna',
      equipmentUsed: ['dumbbells'],
      sets: [
        { reps: 10, weightKg: 14, completed: true },
        { reps: 10, weightKg: 14, completed: true },
        { reps: 10, weightKg: 14, completed: true },
      ],
    },
    {
      exerciseId: 'ex_db_one_arm_row',
      exerciseName: 'Remo a una mano con mancuerna',
      equipmentUsed: ['dumbbells'],
      sets: [
        { reps: 12, weightKg: 16, completed: true },
        { reps: 12, weightKg: 16, completed: true },
        { reps: 12, weightKg: 16, completed: true },
      ],
    },
  ];
  list.push({
    id: 'act_seed_str_1',
    source: 'bilifit_home',
    sport: 'strength',
    subSport: 'Rutina en Casa',
    title: 'Fuerza y Estabilidad para Correr & Montaña',
    description: 'Sesión completada con mancuernas, bandas y esterilla en casa.',
    daysAgo: 3,
    hour: 19,
    durationSec: 2150,
    distanceMeters: 0,
    elevationGain: 0,
    elevationLoss: 0,
    avgHr: 118,
    maxHr: 144,
    rpe: 7,
    points: [],
    strengthLogs: strengthLogs1,
    totalVolumeKg: 1596,
  });

  // 4. Rodaje Running (hace 5 días)
  const run1 = buildGpsLoop(43.362, -5.849, 0.014, 0.018, 228, 75, 2940, 80, 149, 3.45);
  list.push({
    id: 'act_seed_run_1',
    source: 'strava',
    sport: 'running',
    subSport: 'Correr',
    title: 'Rodaje Aeróbico Parque Invierno + Pista Finlandesa',
    description: 'Ritmo cómodo en Z2-Z3, piernas frescas.',
    daysAgo: 5,
    hour: 8,
    durationSec: 2940,
    distanceMeters: run1.distanceMeters,
    elevationGain: run1.gain,
    elevationLoss: run1.loss,
    avgHr: 149,
    maxHr: 166,
    avgCadence: 174,
    rpe: 5,
    gearId: 'gear_road_shoes',
    points: enrichPointsTelemetry(run1.points, 'running'),
    polyline: run1.polyline,
  });

  // 5. MyWhoosh Climb Colombia (hace 6 días)
  const mw2 = buildMyWhooshTelemetry(4200, 229, 'climb', 158, 'Colombia');
  list.push({
    id: 'act_seed_mw_2',
    source: 'fit',
    sport: 'mywhoosh',
    subSport: 'MyWhoosh Indoor',
    title: 'MyWhoosh · Ascensión Alto de Letras (Colombia)',
    description: 'Simulación de puerto largo en MyWhoosh trabajando cadencia en subida.',
    daysAgo: 6,
    hour: 18,
    durationSec: 4200,
    distanceMeters: mw2.points[mw2.points.length - 1].dist ?? 28400,
    elevationGain: 680,
    elevationLoss: 40,
    avgHr: 159,
    maxHr: 181,
    avgWatts: 229,
    maxWatts: 348,
    avgCadence: 79,
    rpe: 8,
    gearId: 'gear_trainer_bike',
    worldName: 'Colombia',
    points: mw2.points,
    polyline: mw2.polyline,
  });

  // Historial de 8 semanas adicionales para que el gráfico de Fitness/Fatiga (CTL/ATL/TSB) y semanal sea rico
  const patternDays = [8, 10, 12, 14, 16, 18, 20, 22, 24, 27, 29, 31, 34, 37, 40, 43, 46, 50, 54, 58, 63];
  patternDays.forEach((dAgo, idx) => {
    const kind = idx % 4;
    if (kind === 0) {
      // Running
      const dur = 2600 + (idx % 3) * 450;
      const runLoop = buildGpsLoop(43.362, -5.849, 0.014, 0.018, 225, 65, dur, 70, 150, 3.4);
      list.push({
        id: `act_hist_run_${idx}`,
        source: 'strava',
        sport: 'running',
        subSport: idx % 8 === 0 ? 'Series / Tempo' : 'Correr',
        title: idx % 8 === 0 ? 'Fartlek progresivo 10 km' : 'Carrera continua suave',
        description: 'Sesión sincronizada desde Strava.',
        daysAgo: dAgo,
        hour: 8,
        durationSec: dur,
        distanceMeters: runLoop.distanceMeters,
        elevationGain: runLoop.gain,
        elevationLoss: runLoop.loss,
        avgHr: 151,
        maxHr: 174,
        avgCadence: 173,
        rpe: 6,
        gearId: 'gear_road_shoes',
        points: enrichPointsTelemetry(runLoop.points, 'running'),
        polyline: runLoop.polyline,
      });
    } else if (kind === 1) {
      // MyWhoosh
      const dur = 3000 + (idx % 3) * 600;
      const mode = idx % 3 === 0 ? 'vo2' : idx % 3 === 1 ? 'endurance' : 'sweetspot';
      const avgW = mode === 'vo2' ? 215 : mode === 'sweetspot' ? 222 : 190;
      const worlds = ['Arabia', 'Belgium', 'Hudayriyat', 'AlUla'];
      const world = worlds[idx % worlds.length];
      const mwHist = buildMyWhooshTelemetry(dur, avgW, mode, 148, world);
      list.push({
        id: `act_hist_mw_${idx}`,
        source: 'gpx',
        sport: 'mywhoosh',
        subSport: 'MyWhoosh Indoor',
        title: `MyWhoosh · ${world} (${mode === 'vo2' ? 'Intervalos VO2' : mode === 'sweetspot' ? 'Tempo SweetSpot' : 'Rodaje Z2'})`,
        description: 'Importación con stream completo de potencia y cadencia.',
        daysAgo: dAgo,
        hour: 18,
        durationSec: dur,
        distanceMeters: mwHist.points[mwHist.points.length - 1].dist ?? 30000,
        elevationGain: 160 + (idx % 3) * 110,
        elevationLoss: 150,
        avgHr: mode === 'endurance' ? 136 : 154,
        maxHr: mode === 'vo2' ? 182 : 168,
        avgWatts: avgW,
        maxWatts: mode === 'vo2' ? 395 : 295,
        avgCadence: 88,
        rpe: mode === 'endurance' ? 5 : 8,
        gearId: 'gear_trainer_bike',
        worldName: world,
        points: mwHist.points,
        polyline: mwHist.polyline,
      });
    } else if (kind === 2) {
      // Montaña: alternar entre Trail Running y Senderismo
      const isTrail = Math.floor(idx / 4) % 2 === 0;
      const dur = 5400 + (idx % 3) * 1800;
      const mtnLoop = buildGpsLoop(43.385, -5.868, 0.017, 0.022, 210, 420 + (idx % 2) * 120, dur, 80, 144, isTrail ? 2.5 : 1.7);
      list.push({
        id: `act_hist_mtn_${idx}`,
        source: 'gpx',
        sport: isTrail ? 'trail' : 'mountain',
        subSport: isTrail ? 'Trail Running' : 'Senderismo',
        title: isTrail ? 'Salida Trail Monte Naranco' : 'Ruta de Senderismo Asturias',
        description: 'Ruta de desnivel acumulado para preparar salidas largas.',
        daysAgo: dAgo,
        hour: 9,
        durationSec: dur,
        distanceMeters: mtnLoop.distanceMeters,
        elevationGain: mtnLoop.gain,
        elevationLoss: mtnLoop.loss,
        avgHr: 145,
        maxHr: 173,
        rpe: 7,
        gearId: 'gear_trail_shoes',
        points: enrichPointsTelemetry(mtnLoop.points, isTrail ? 'trail' : 'mountain'),
        polyline: mtnLoop.polyline,
      });
    } else {
      // Fuerza en casa
      list.push({
        id: `act_hist_str_${idx}`,
        source: 'bilifit_home',
        sport: 'strength',
        subSport: 'Rutina en Casa',
        title: idx % 2 === 0 ? 'Core, Espalda y Bisagra Post-MyWhoosh' : 'Fuerza General con Mancuernas y Bandas',
        description: 'Entrenamiento en casa adaptado al material disponible.',
        daysAgo: dAgo,
        hour: 19,
        durationSec: 2100,
        distanceMeters: 0,
        elevationGain: 0,
        elevationLoss: 0,
        avgHr: 116,
        maxHr: 140,
        rpe: 6,
        points: [],
        strengthLogs: strengthLogs1,
        totalVolumeKg: 1420 + idx * 15,
      });
    }
  });

  return list.map((a) => {
    const np = a.avgWatts ? calculateNormalizedPower(a.points) ?? a.avgWatts : undefined;
    return {
      ...a,
      // Pre-attach computed metrics in seed consumer
      normalizedPower: np,
    } as SeedActivitySpec & { normalizedPower?: number };
  });
}

export function buildSeedActivityRows(profile: AthleteProfile) {
  return buildSeedActivities().map((spec) => {
    const np = spec.avgWatts ? calculateNormalizedPower(spec.points) ?? spec.avgWatts : null;
    const tss = estimateActivityTSS(
      {
        sport: spec.sport,
        durationSec: spec.durationSec,
        movingTimeSec: spec.durationSec,
        avgWatts: spec.avgWatts ?? null,
        normalizedPower: np,
        avgHr: spec.avgHr ?? null,
        rpe: spec.rpe ?? null,
        elevationGain: spec.elevationGain,
      },
      profile
    );
    const avgSpeedMs =
      spec.distanceMeters > 0 && spec.durationSec > 0
        ? Math.round((spec.distanceMeters / spec.durationSec) * 100) / 100
        : null;
    const startPt = spec.points.find((p) => typeof p.lat === 'number' && typeof p.lon === 'number');
    const extras = computeSessionExtras(
      {
        sport: spec.sport,
        durationSec: spec.durationSec,
        movingTimeSec: spec.durationSec,
        distanceMeters: spec.distanceMeters,
        elevationGain: spec.elevationGain,
        avgSpeedMs,
        avgHr: spec.avgHr ?? null,
        avgWatts: spec.avgWatts ?? null,
        normalizedPower: np,
        extras: {
          deviceName: spec.sport === 'mywhoosh' ? 'MyWhoosh 5.4 + Wahoo KICKR' : spec.sport === 'strength' ? 'Bilifit App' : 'Reloj GPS',
        },
      },
      spec.points
    );

    return {
      id: spec.id,
      externalId: null,
      source: spec.source,
      sport: spec.sport,
      subSport: spec.subSport,
      title: spec.title,
      description: spec.description,
      startedAt: daysAgoIso(spec.daysAgo, spec.hour, 15),
      durationSec: spec.durationSec,
      movingTimeSec: spec.durationSec,
      distanceMeters: spec.distanceMeters,
      elevationGain: spec.elevationGain,
      elevationLoss: spec.elevationLoss,
      avgSpeedMs,
      maxSpeedMs: avgSpeedMs ? Math.round(avgSpeedMs * 1.35 * 100) / 100 : null,
      avgHr: spec.avgHr ?? null,
      maxHr: spec.maxHr ?? null,
      avgWatts: spec.avgWatts ?? null,
      normalizedPower: np,
      maxWatts: spec.maxWatts ?? null,
      avgCadence: spec.avgCadence ?? null,
      calories: Math.round((spec.durationSec / 60) * (spec.sport === 'strength' ? 6.5 : 10.5)),
      tss,
      rpe: spec.rpe ?? 6,
      gearId: spec.gearId ?? null,
      worldName: spec.worldName ?? null,
      polyline: spec.polyline ?? null,
      startLat: startPt?.lat ?? null,
      startLon: startPt?.lon ?? null,
      points: spec.points,
      strengthLogs: spec.strengthLogs ?? [],
      totalVolumeKg: spec.totalVolumeKg ?? null,
      laps: [],
      extras,
      createdAt: daysAgoIso(spec.daysAgo, spec.hour, 15),
    };
  });
}

export { DEFAULT_HOME_EQUIPMENT };
