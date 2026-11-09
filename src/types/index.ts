export type SportType = 'running' | 'mywhoosh' | 'cycling' | 'mountain' | 'strength';

export interface ActivityPoint {
  t: number; // elapsed seconds
  lat?: number;
  lon?: number;
  ele?: number; // meters
  hr?: number; // bpm
  watts?: number; // W
  cad?: number; // rpm or spm
  speed?: number; // m/s
  dist?: number; // cumulative meters
}

export interface StrengthSetLog {
  exerciseId: string;
  exerciseName: string;
  equipmentUsed: string[];
  sets: Array<{
    reps: number;
    weightKg: number;
    durationSec?: number;
    completed: boolean;
  }>;
}

export interface Activity {
  id: string;
  externalId?: string | null;
  source: 'manual' | 'gpx' | 'fit' | 'tcx' | 'strava' | 'bilifit_home';
  sport: SportType;
  subSport?: string | null;
  title: string;
  description?: string | null;
  startedAt: string; // ISO date string
  durationSec: number;
  movingTimeSec: number;
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  avgSpeedMs?: number | null;
  maxSpeedMs?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
  normalizedPower?: number | null;
  maxWatts?: number | null;
  avgCadence?: number | null;
  calories?: number | null;
  tss: number;
  rpe?: number | null; // 1-10
  gearId?: string | null;
  gearName?: string | null;
  worldName?: string | null; // MyWhoosh world e.g. Arabia, Hudayriyat, Belgium
  polyline?: string | null;
  startLat?: number | null;
  startLon?: number | null;
  totalVolumeKg?: number | null;
  createdAt: string;
}

export interface ActivityDetail extends Activity {
  points: ActivityPoint[];
  strengthLogs: StrengthSetLog[];
  powerCurve?: Array<{ durationSec: number; label: string; watts: number }>;
}

export interface MountainRoute {
  id: string;
  name: string;
  region: string;
  difficulty: 'Fácil' | 'Moderada' | 'Exigente' | 'Alta Montaña';
  sport: 'mountain' | 'cycling';
  distanceMeters: number;
  elevationGain: number;
  elevationLoss: number;
  maxEle: number;
  minEle: number;
  estimatedTimeSec: number;
  status: 'pending' | 'completed';
  notes?: string | null;
  polyline?: string | null;
  points: ActivityPoint[];
  createdAt: string;
}

export interface GearItem {
  id: string;
  name: string;
  brand?: string | null;
  category: 'running_shoes' | 'trail_shoes' | 'road_bike' | 'mtb_bike' | 'indoor_trainer';
  defaultForSport?: SportType | null;
  initialKm: number;
  trackedKm: number;
  maxKm: number;
  active: boolean;
  notes?: string | null;
}

export interface HomeEquipment {
  id: string;
  name: string;
  category: 'peso_libre' | 'calistenia' | 'resistencia' | 'cardio' | 'accesorio';
  description: string;
  owned: boolean;
  details?: string | null; // e.g. "2 x 2-24 kg", "16 kg"
  isCustom?: boolean;
}

export type MuscleGroup =
  | 'piernas'
  | 'pecho'
  | 'espalda'
  | 'hombros'
  | 'brazos'
  | 'core'
  | 'full_body'
  | 'movilidad';

export type RoutineGoal =
  | 'fuerza_general'
  | 'correr_montana'
  | 'ciclismo_mywhoosh'
  | 'full_body_hiit'
  | 'tren_superior'
  | 'tren_inferior'
  | 'core_movilidad';

export interface Exercise {
  id: string;
  name: string;
  muscleGroup: MuscleGroup;
  secondaryMuscles: MuscleGroup[];
  requiredEquipment: string[]; // All listed equipment IDs are required (empty = bodyweight)
  optionalEquipment?: string[];
  difficulty: 'principiante' | 'intermedio' | 'avanzado';
  pattern: 'empuje' | 'traccion' | 'rodilla' | 'bisagra' | 'unilateral' | 'core' | 'cardio' | 'movilidad';
  sportBenefit: Array<'running' | 'mountain' | 'mywhoosh' | 'general'>;
  defaultSets: number;
  defaultReps: string; // e.g. "10-12", "40s", "8 por pierna"
  restSeconds: number;
  instructions: string;
  isCustom?: boolean;
}

export interface RoutineExerciseItem {
  exerciseId: string;
  exerciseName: string;
  muscleGroup: MuscleGroup;
  requiredEquipment: string[];
  sets: number;
  reps: string;
  suggestedWeightKg?: number;
  restSeconds: number;
  notes?: string;
}

export interface Routine {
  id: string;
  name: string;
  goal: RoutineGoal;
  level: 'principiante' | 'intermedio' | 'avanzado';
  estimatedMinutes: number;
  equipmentIds: string[];
  items: RoutineExerciseItem[];
  notes?: string | null;
  timesCompleted: number;
  lastCompletedAt?: string | null;
  createdAt: string;
}

export interface AthleteProfile {
  name: string;
  weightKg: number;
  ftpWatts: number;
  maxHr: number;
  restingHr: number;
  lthr: number;
  weeklyTargetHours: number;
  weeklyTargetKm: number;
}

export interface FitnessDayPoint {
  date: string; // YYYY-MM-DD
  tss: number;
  ctl: number; // Fitness (42d)
  atl: number; // Fatigue (7d)
  tsb: number; // Form (CTL - ATL)
}

export interface StravaConnectionStatus {
  configured: boolean;
  connected: boolean;
  hasEnvCredentials: boolean;
  clientId?: string | null;
  athleteId?: number | null;
  athleteName?: string | null;
  lastSyncAt?: string | null;
  tokenExpiresAt?: number | null;
  redirectUriHint?: string;
}
