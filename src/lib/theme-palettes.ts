import { THEMES, type CustomPalette, type PaletteColors, type ThemeId } from '@/lib/themes';

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const PALETTE_ID_RE = /^[a-zA-Z0-9_-]{1,90}$/;

const FALLBACK_LIGHT: PaletteColors = {
  bg: '#eef8ff',
  surface: '#ffffff',
  ink: '#12324a',
  primary: '#0284c7',
  accent: '#0f766e',
  accent2: '#f59e0b',
};

const FALLBACK_DARK: PaletteColors = {
  bg: '#061928',
  surface: '#0b2a42',
  ink: '#e8f6ff',
  primary: '#38bdf8',
  accent: '#2dd4bf',
  accent2: '#fbbf24',
};

type Rgb = [number, number, number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_RE.test(value.trim());
}

export function normalizeHexColor(value: unknown, fallback: string): string {
  return isHexColor(value) ? value.trim().toLowerCase() : fallback.toLowerCase();
}

function hexToRgb(hex: string): Rgb {
  const clean = normalizeHexColor(hex, '#000000').slice(1);
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function rgbToHex([red, green, blue]: Rgb): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  const ratio = Math.max(0, Math.min(1, amount));
  return [
    from[0] + (to[0] - from[0]) * ratio,
    from[1] + (to[1] - from[1]) * ratio,
    from[2] + (to[2] - from[2]) * ratio,
  ];
}

export function mixHexColors(from: string, to: string, amount: number): string {
  return rgbToHex(mixRgb(hexToRgb(from), hexToRgb(to), amount));
}

function rgbComponents(hex: string): string {
  return hexToRgb(hex).join(' ');
}

function luminance(hex: string): number {
  const [red, green, blue] = hexToRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function readableTextColor(background: string): string {
  return luminance(background) > 0.32 ? '#101828' : '#ffffff';
}

export function sanitizePaletteColors(value: unknown, fallback: PaletteColors): PaletteColors {
  const record = isRecord(value) ? value : {};
  return {
    bg: normalizeHexColor(record.bg, fallback.bg),
    surface: normalizeHexColor(record.surface, fallback.surface),
    ink: normalizeHexColor(record.ink, fallback.ink),
    primary: normalizeHexColor(record.primary, fallback.primary),
    accent: normalizeHexColor(record.accent, fallback.accent),
    accent2: normalizeHexColor(record.accent2, fallback.accent2),
  };
}

export function generateDarkPaletteColors(light: PaletteColors): PaletteColors {
  const clean = sanitizePaletteColors(light, FALLBACK_LIGHT);
  const bg = mixHexColors(clean.primary, '#020617', 0.9);
  return {
    bg,
    surface: mixHexColors(bg, '#ffffff', 0.1),
    ink: mixHexColors(clean.bg, '#ffffff', 0.92),
    primary: mixHexColors(clean.primary, '#ffffff', 0.18),
    accent: mixHexColors(clean.accent, '#ffffff', 0.12),
    accent2: mixHexColors(clean.accent2, '#ffffff', 0.1),
  };
}

export function generateLightPaletteColors(dark: PaletteColors): PaletteColors {
  const clean = sanitizePaletteColors(dark, FALLBACK_DARK);
  return {
    bg: mixHexColors(clean.bg, '#ffffff', 0.93),
    surface: '#ffffff',
    ink: mixHexColors(clean.primary, '#111827', 0.72),
    primary: mixHexColors(clean.primary, '#111827', 0.08),
    accent: mixHexColors(clean.accent, '#111827', 0.05),
    accent2: clean.accent2,
  };
}

export function paletteColorsFromTheme(themeId: ThemeId): { light: PaletteColors; dark: PaletteColors } {
  const theme = THEMES.find((item) => item.id === themeId) || THEMES[0];
  const preview = theme.preview;
  const seed: PaletteColors = {
    bg: preview.bg.toLowerCase(),
    surface: preview.surface.toLowerCase(),
    ink: preview.ink.toLowerCase(),
    primary: preview.primary.toLowerCase(),
    accent: preview.accent2.toLowerCase(),
    accent2: mixHexColors(preview.primary, preview.accent2, 0.45),
  };

  if (theme.darkOnly) {
    return { light: generateLightPaletteColors(seed), dark: seed };
  }
  return { light: seed, dark: generateDarkPaletteColors(seed) };
}

export function sanitizeCustomPalettes(value: unknown): CustomPalette[] {
  if (!Array.isArray(value)) return [];

  const validThemes = new Set(THEMES.map((theme) => theme.id));
  const seen = new Set<string>();
  const palettes: CustomPalette[] = [];

  for (const raw of value.slice(0, 40)) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!PALETTE_ID_RE.test(id) || seen.has(id)) continue;

    const baseTheme = validThemes.has(raw.baseTheme as ThemeId)
      ? (raw.baseTheme as ThemeId)
      : 'calido';
    const fallback = paletteColorsFromTheme(baseTheme);
    const name = typeof raw.name === 'string' && raw.name.trim()
      ? raw.name.trim().slice(0, 40)
      : 'Mi paleta';

    palettes.push({
      id,
      name,
      baseTheme,
      light: sanitizePaletteColors(raw.light, fallback.light),
      dark: sanitizePaletteColors(raw.dark, fallback.dark),
      createdAt: typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : 0,
    });
    seen.add(id);
    if (palettes.length >= 24) break;
  }

  return palettes;
}

export function buildPaletteCssVars(colors: PaletteColors, dark: boolean): Record<string, string> {
  const clean = sanitizePaletteColors(colors, dark ? FALLBACK_DARK : FALLBACK_LIGHT);
  const raised = mixHexColors(clean.surface, '#ffffff', dark ? 0.07 : 0.35);
  const sunken = mixHexColors(clean.bg, clean.ink, dark ? 0.05 : 0.055);
  const line = mixHexColors(clean.surface, clean.ink, dark ? 0.2 : 0.13);
  const line2 = mixHexColors(clean.surface, clean.ink, dark ? 0.34 : 0.24);
  const ink2 = mixHexColors(clean.ink, clean.bg, 0.34);
  const ink3 = mixHexColors(clean.ink, clean.bg, 0.54);
  const primaryHover = mixHexColors(clean.primary, dark ? '#ffffff' : '#000000', 0.13);
  const onPrimary = readableTextColor(clean.primary);
  const gold = mixHexColors(clean.accent2, '#ffd166', 0.35);
  const chart5 = mixHexColors(clean.primary, clean.accent, 0.52);

  return {
    '--bg': rgbComponents(clean.bg),
    '--surface': rgbComponents(clean.surface),
    '--raised': rgbComponents(raised),
    '--sunken': rgbComponents(sunken),
    '--line': rgbComponents(line),
    '--line-2': rgbComponents(line2),
    '--ink': rgbComponents(clean.ink),
    '--ink-2': rgbComponents(ink2),
    '--ink-3': rgbComponents(ink3),
    '--primary': rgbComponents(clean.primary),
    '--primary-hover': rgbComponents(primaryHover),
    '--on-primary': rgbComponents(onPrimary),
    '--on-grad': rgbComponents(onPrimary),
    '--accent': rgbComponents(clean.accent),
    '--accent-2': rgbComponents(clean.accent2),
    '--gold': rgbComponents(gold),
    '--glow': rgbComponents(mixHexColors(clean.primary, '#ffffff', dark ? 0.05 : 0.3)),
    '--st-pending': rgbComponents(mixHexColors(clean.accent2, '#d97706', 0.45)),
    '--st-reading': rgbComponents(clean.primary),
    '--st-read': rgbComponents(mixHexColors(clean.accent, '#4caf50', 0.35)),
    '--danger': rgbComponents(dark ? '#f87171' : '#dc2626'),
    '--chart-1': rgbComponents(clean.primary),
    '--chart-2': rgbComponents(clean.accent),
    '--chart-3': rgbComponents(gold),
    '--chart-4': rgbComponents(clean.accent2),
    '--chart-5': rgbComponents(chart5),
    '--chart-6': rgbComponents(ink2),
  };
}

export const CUSTOM_PALETTE_CSS_VAR_KEYS = Object.freeze(
  Object.keys(buildPaletteCssVars(FALLBACK_LIGHT, false)),
);

export function applyCustomPaletteToRoot(palette: CustomPalette | null | undefined, dark: boolean): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;

  for (const key of CUSTOM_PALETTE_CSS_VAR_KEYS) {
    root.style.removeProperty(key);
  }
  root.style.colorScheme = dark ? 'only dark' : 'only light';

  if (!palette) return;

  const colors = dark ? palette.dark : palette.light;
  const vars = buildPaletteCssVars(colors, dark);
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}
