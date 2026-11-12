export type ThemeId =
  | 'calido'
  | 'minimal'
  | 'nocturno'
  | 'vibrante'
  | 'oceano'
  | 'bosque'
  | 'atardecer'
  | 'lavanda';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  tagline: string;
  darkOnly?: boolean;
  /** Colores fijos (hex) solo para dibujar la mini-vista previa en el selector. */
  preview: {
    bg: string;
    surface: string;
    line: string;
    ink: string;
    ink2: string;
    primary: string;
    onPrimary: string;
    accent2: string;
    radius: number;
    fontDisplay: string;
  };
}

/** Colores semilla de una paleta personalizada. El resto de tokens se derivan. */
export interface PaletteColors {
  bg: string;
  surface: string;
  ink: string;
  primary: string;
  accent: string;
  accent2: string;
}

export interface CustomPalette {
  id: string;
  name: string;
  /** Tema integrado que aporta tipografía, radios y sombras. */
  baseTheme: ThemeId;
  light: PaletteColors;
  dark: PaletteColors;
  createdAt: number;
}

export interface AppSettings {
  theme: ThemeId;
  dark: boolean;
  customPalettes: CustomPalette[];
  customPaletteId: string | null;
  /** Crece en el servidor con cada cambio; sirve para sincronizar dispositivos. */
  settingsVersion: number;
  /** Versión del protocolo continuo de ajustes que ofrece el servidor. */
  settingsSyncProtocol: number;
}

export const SETTINGS_SYNC_PROTOCOL = 2;

export const THEMES: ThemeMeta[] = [
  {
    id: 'calido',
    label: 'Rincón cálido',
    tagline: 'Papel, terracota y serif editorial. Como entrenar con luz de tarde.',
    preview: {
      bg: '#FAF6EF',
      surface: '#FFFCF7',
      line: '#E7DBC7',
      ink: '#3A2D24',
      ink2: '#7A6656',
      primary: '#BF5B37',
      onPrimary: '#FFFAF2',
      accent2: '#6B865A',
      radius: 14,
      fontDisplay: 'Fraunces, Georgia, serif',
    },
  },
  {
    id: 'minimal',
    label: 'Minimal',
    tagline: 'Neutros limpios, acento índigo y mucho aire. Sobrio y profesional.',
    preview: {
      bg: '#FAFAFA',
      surface: '#FFFFFF',
      line: '#E5E5E7',
      ink: '#18181B',
      ink2: '#52525B',
      primary: '#18181B',
      onPrimary: '#FAFAFA',
      accent2: '#4F46E5',
      radius: 9,
      fontDisplay: 'Inter, system-ui, sans-serif',
    },
  },
  {
    id: 'nocturno',
    label: 'Nocturno',
    tagline: 'Tinta y dorado para revisar entrenos de noche. Siempre en modo oscuro.',
    darkOnly: true,
    preview: {
      bg: '#0C0E19',
      surface: '#151828',
      line: '#2B3049',
      ink: '#EEEADE',
      ink2: '#B2B0BF',
      primary: '#C9A24B',
      onPrimary: '#1D1607',
      accent2: '#8E9EE0',
      radius: 12,
      fontDisplay: 'Fraunces, Georgia, serif',
    },
  },
  {
    id: 'vibrante',
    label: 'Vibrante',
    tagline: 'Violeta, rosa y formas redondeadas. Colorido y con energía.',
    preview: {
      bg: '#F7F5FF',
      surface: '#FFFFFF',
      line: '#E2DBFF',
      ink: '#2E2254',
      ink2: '#685C8C',
      primary: '#7C3AED',
      onPrimary: '#FFFFFF',
      accent2: '#DB2777',
      radius: 18,
      fontDisplay: 'Nunito, system-ui, sans-serif',
    },
  },
  {
    id: 'oceano',
    label: 'Océano',
    tagline: 'Azul claro, espuma y turquesa. Fresco como correr frente al mar.',
    preview: {
      bg: '#EEF8FF',
      surface: '#FFFFFF',
      line: '#CBE8F7',
      ink: '#12324A',
      ink2: '#527A94',
      primary: '#0284C7',
      onPrimary: '#FFFFFF',
      accent2: '#0F766E',
      radius: 17,
      fontDisplay: 'Inter, system-ui, sans-serif',
    },
  },
  {
    id: 'bosque',
    label: 'Bosque',
    tagline: 'Verdes botánicos y dorados suaves para perderse por senderos.',
    preview: {
      bg: '#F2F7ED',
      surface: '#FCFEF9',
      line: '#D4E4C3',
      ink: '#23351F',
      ink2: '#5F7458',
      primary: '#3F7A3A',
      onPrimary: '#FFFFFF',
      accent2: '#B7791F',
      radius: 16,
      fontDisplay: 'Fraunces, Georgia, serif',
    },
  },
  {
    id: 'atardecer',
    label: 'Atardecer',
    tagline: 'Coral, ámbar y ciruela. Cálido, expresivo y muy deportivo.',
    preview: {
      bg: '#FFF4E8',
      surface: '#FFFBF5',
      line: '#F6D7C3',
      ink: '#4A2718',
      ink2: '#8A6351',
      primary: '#E4572E',
      onPrimary: '#FFFFFF',
      accent2: '#D97706',
      radius: 19,
      fontDisplay: 'Fraunces, Georgia, serif',
    },
  },
  {
    id: 'lavanda',
    label: 'Lavanda',
    tagline: 'Lilas suaves con rosa y menta. Delicado, luminoso y tranquilo.',
    preview: {
      bg: '#F5F1FF',
      surface: '#FFFFFF',
      line: '#DED2FA',
      ink: '#35245E',
      ink2: '#74658F',
      primary: '#7C5CDB',
      onPrimary: '#FFFFFF',
      accent2: '#DB6FA5',
      radius: 21,
      fontDisplay: 'Nunito, system-ui, sans-serif',
    },
  },
];

export const VALID_THEMES: ThemeId[] = THEMES.map((t) => t.id);

export const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'calido',
  dark: false,
  customPalettes: [],
  customPaletteId: null,
  settingsVersion: 0,
  settingsSyncProtocol: SETTINGS_SYNC_PROTOCOL,
};
