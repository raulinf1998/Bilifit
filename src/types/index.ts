export type SportType = 'running' | 'trail' | 'mywhoosh' | 'cycling' | 'mountain' | 'walking' | 'strength';

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
  temp?: number; // °C
  grade?: number; // % slope
  gct?: number; // ground contact time ms
  vo?: number; // vertical oscillation mm
  stride?: number; // stride length m
  lrBalance?: number; // % left leg power
}

export interface ActivityLap {
  lapNumber: number;
  name?: string;
  startDistM: number;
  endDistM: number;
  distanceMeters: number;
  durationSec: number;
  movingTimeSec: number;
  avgSpeedMs?: number | null;
  maxSpeedMs?: number | null;
  gapSpeedMs?: number | null;
  elevationGain: number;
  elevationLoss: number;
  avgGradePct?: number | null;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
  normalizedPower?: number | null;
  avgCadence?: number | null;
  calories?: number | null;
  trigger?: string | null;
}

export interface BestEffortItem {
  label: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedMs: number;
  avgHr?: number | null;
  avgWatts?: number | null;
  startDistM: number;
  endDistM: number;
}

export interface ZoneBucket {
  zone: string;
  name: string;
  range: string;
  seconds: number;
  percent: number;
  color: string;
}

export interface TerrainSplit {
  type: 'subida' | 'llano' | 'bajada';
  label: string;
  distanceMeters: number;
  durationSec: number;
  avgSpeedMs: number | null;
}

export interface ActivityExtras {
  deviceName?: string | null;
  steps?: number | null;
  originApp?: string | null;
  avgTemp?: number | null;
  minTemp?: number | null;
  maxTemp?: number | null;
  aerobicTe?: number | null;
  anaerobicTe?: number | null;
  workKj?: number | null;
  variabilityIndex?: number | null;
  efficiencyFactor?: number | null;
  aerobicDecouplingPct?: number | null;
  vamMh?: number | null;
  gapSpeedMs?: number | null;
  minEle?: number | null;
  maxEle?: number | null;
  avgGctMs?: number | null;
  avgVerticalOscMm?: number | null;
  avgStrideLenM?: number | null;
  leftBalancePct?: number | null;
  rightBalancePct?: number | null;
}

export interface Segment {
  id: string;
  name: string;
  sport: SportType;
  category: 'climb' | 'sprint' | 'flat' | 'custom';
  distanceMeters: number;
  elevationGain: number;
  avgGradePct: number;
  maxGradePct: number;
  startLat: number;
  startLon: number;
  endLat: number;
  endLon: number;
  polyline: string;
  points: Array<{ lat: number; lon: number; ele?: number; dist?: number }>;
  sourceActivityId?: string | null;
  worldName?: string | null;
  createdAt: string;
  effortCount?: number;
  bestTimeSec?: number | null;
  bestEffortDate?: string | null;
}

export interface SegmentEffort {
  id: string;
  segmentId: string;
  segmentName: string;
  segmentDistanceMeters?: number;
  segmentElevationGain?: number;
  segmentAvgGradePct?: number;
  segmentPolyline?: string | null;
  activityId: string;
  activityTitle: string;
  startedAt: string;
  sport: SportType;
  durationSec: number;
  avgSpeedMs: number;
  avgHr?: number | null;
  maxHr?: number | null;
  avgWatts?: number | null;
  avgCadence?: number | null;
  vamMh?: number | null;
  prRank?: number;
  prDeltaSec?: number;
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
  source: 'manual' | 'gpx' | 'fit' | 'tcx' | 'strava' | 'mywhoosh' | 'huawei' | 'bilifit_home';
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
  doneTogether?: boolean;
  excludePausedTime?: boolean;
  trimmed?: boolean;
  images?: string[];
  laps?: ActivityLap[];
  extras?: ActivityExtras | null;
  createdAt: string;
}

export interface ActivityDetail extends Activity {
  points: ActivityPoint[];
  strengthLogs: StrengthSetLog[];
  powerCurve?: Array<{ durationSec: number; label: string; watts: number }>;
  kmSplits?: ActivityLap[];
  bestEfforts?: BestEffortItem[];
  hrZones?: ZoneBucket[];
  paceZones?: ZoneBucket[];
  terrainBreakdown?: TerrainSplit[];
  segmentEfforts?: SegmentEffort[];
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
  requiredEquipment: string[];
  optionalEquipment?: string[];
  difficulty: 'principiante' | 'intermedio' | 'avanzado';
  pattern: 'empuje' | 'traccion' | 'rodilla' | 'bisagra' | 'unilateral' | 'core' | 'cardio' | 'movilidad';
  sportBenefit: Array<'running' | 'mountain' | 'mywhoosh' | 'general'>;
  defaultSets: number;
  defaultReps: string;
  restSeconds: number;
  instructions: string;
  imageUrl?: string | null;
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
  imageUrl?: string | null;
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
  coverImageUrl?: string | null;
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

export interface MyWhooshImportLog {
  activityId: string;
  activityFileId?: string | null;
  localActivityId?: string | null;
  title: string;
  startedAt?: string | null;
  status: 'imported' | 'skipped' | 'failed';
  error?: string | null;
  importedAt: string;
}

export interface MyWhooshConnectionStatus {
  connected: boolean;
  hasEnvCredentials: boolean;
  hasSavedPassword: boolean;
  email?: string | null;
  whooshId?: string | null;
  riderName?: string | null;
  ftpWatts?: number | null;
  autoSyncEnabled: boolean;
  syncIntervalMin: number;
  syncInProgress: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus: 'idle' | 'ok' | 'error' | 'needs_reconnect';
  lastError?: string | null;
  tokenExpiresAt?: number | null;
  importedCount: number;
  recentImports: MyWhooshImportLog[];
}

export interface MyWhooshSyncResult {
  imported: number;
  updated?: number;
  skipped: number;
  failed: number;
  totalFetched: number;
  errors: string[];
}

export interface HuaweiImportLog {
  itemKey: string;
  fileName: string;
  driveFileId?: string | null;
  localActivityId?: string | null;
  title: string;
  startedAt?: string | null;
  channel: 'folder' | 'drive' | 'upload';
  status: 'imported' | 'skipped' | 'failed';
  error?: string | null;
  importedAt: string;
}

export interface HuaweiConnectionStatus {
  accountId?: 'raul' | 'pequenaja';
  watchDir: string;
  watchDirExists: boolean;
  watchDirFileCount: number;
  googleConfigured: boolean;
  googleConnected: boolean;
  hasGoogleEnvCredentials: boolean;
  sharedOAuthAppConfigured?: boolean;
  googleClientId?: string | null;
  googleAccountEmail?: string | null;
  driveFolderId?: string | null;
  driveFolderName?: string | null;
  googleRedirectUriHint?: string;
  autoSyncEnabled: boolean;
  syncIntervalMin: number;
  syncInProgress: boolean;
  lastSyncAt?: string | null;
  lastSyncStatus: 'idle' | 'ok' | 'error' | 'needs_reconnect';
  lastError?: string | null;
  importedCount: number;
  recentImports: HuaweiImportLog[];
}

export interface HuaweiSyncResult {
  imported: number;
  updated?: number;
  skipped: number;
  failed: number;
  scanned: number;
  errors: string[];
}

