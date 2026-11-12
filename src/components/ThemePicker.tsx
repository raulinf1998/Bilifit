'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Check,
  Moon,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Sun,
  Trash2,
} from 'lucide-react';
import type { SettingsSyncStatus } from '@/hooks/useServerSettings';
import {
  generateDarkPaletteColors,
  generateLightPaletteColors,
  isHexColor,
  paletteColorsFromTheme,
  sanitizeCustomPalettes,
} from '@/lib/theme-palettes';
import { THEMES, type CustomPalette, type PaletteColors, type ThemeId } from '@/lib/themes';
import { Modal, btnGhost, btnPrimary, btnSoft, cx, inputCls, labelCls, selectCls } from '@/components/ui';

interface Props {
  theme: ThemeId;
  dark: boolean;
  onSetTheme: (t: ThemeId) => void;
  onSetDark: (d: boolean) => void;
  customPalettes: CustomPalette[];
  activeCustomPalette: CustomPalette | null;
  syncStatus: SettingsSyncStatus;
  syncError: string | null;
  onApplyCustomPalette: (palette: CustomPalette) => void;
  onSaveCustomPalette: (palette: CustomPalette) => void;
  onDeleteCustomPalette: (id: string) => void;
  onClose: () => void;
}

const COLOR_FIELDS: { key: keyof PaletteColors; label: string; hint: string }[] = [
  { key: 'bg', label: 'Fondo', hint: 'La base de toda la app' },
  { key: 'surface', label: 'Superficie', hint: 'Tarjetas y paneles' },
  { key: 'ink', label: 'Texto', hint: 'Titulares y lectura' },
  { key: 'primary', label: 'Principal', hint: 'Botones y elementos activos' },
  { key: 'accent', label: 'Acento', hint: 'Detalles y gráficos' },
  { key: 'accent2', label: 'Secundario', hint: 'Contrastes y brillos' },
];

/** Selector de apariencia con paletas integradas y editor de paletas propias. */
export function ThemePicker({
  theme,
  dark,
  onSetTheme,
  onSetDark,
  customPalettes,
  activeCustomPalette,
  syncStatus,
  syncError,
  onApplyCustomPalette,
  onSaveCustomPalette,
  onDeleteCustomPalette,
  onClose,
}: Props) {
  const [editorOpen, setEditorOpen] = useState(false);
  const editorRef = useRef<HTMLElement>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (editorOpen) editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, [editorOpen, editingId]);

  const [paletteName, setPaletteName] = useState('Mi paleta');
  const [baseTheme, setBaseTheme] = useState<ThemeId>(activeCustomPalette?.baseTheme || theme);
  const [lightColors, setLightColors] = useState<PaletteColors>(() =>
    activeCustomPalette?.light || paletteColorsFromTheme(theme).light
  );
  const [darkColors, setDarkColors] = useState<PaletteColors>(() =>
    activeCustomPalette?.dark || paletteColorsFromTheme(theme).dark
  );
  const [editorMode, setEditorMode] = useState<'light' | 'dark'>(dark ? 'dark' : 'light');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const isDarkOnly = theme === 'nocturno' && !activeCustomPalette;
  const editorColors = editorMode === 'dark' ? darkColors : lightColors;

  const beginCreate = () => {
    const seed = activeCustomPalette
      ? { light: activeCustomPalette.light, dark: activeCustomPalette.dark }
      : paletteColorsFromTheme(theme);
    setEditingId(null);
    setPaletteName(activeCustomPalette ? `${activeCustomPalette.name} copia` : `Mi paleta ${customPalettes.length + 1}`);
    setBaseTheme(activeCustomPalette?.baseTheme || theme);
    setLightColors(seed.light);
    setDarkColors(seed.dark);
    setEditorMode(dark ? 'dark' : 'light');
    setEditorOpen(true);
  };

  const beginEdit = (palette: CustomPalette) => {
    setEditingId(palette.id);
    setPaletteName(palette.name);
    setBaseTheme(palette.baseTheme);
    setLightColors(palette.light);
    setDarkColors(palette.dark);
    setEditorMode(dark ? 'dark' : 'light');
    setEditorOpen(true);
  };

  const loadBaseColors = () => {
    const seed = paletteColorsFromTheme(baseTheme);
    setLightColors(seed.light);
    setDarkColors(seed.dark);
  };

  const updateColor = (key: keyof PaletteColors, value: string) => {
    if (editorMode === 'dark') setDarkColors((prev) => ({ ...prev, [key]: value }));
    else setLightColors((prev) => ({ ...prev, [key]: value }));
  };

  const generateOppositeMode = () => {
    if (editorMode === 'light') setDarkColors(generateDarkPaletteColors(lightColors));
    else setLightColors(generateLightPaletteColors(darkColors));
  };

  const handleSave = () => {
    const existing = editingId ? customPalettes.find((palette) => palette.id === editingId) : null;
    const candidate: CustomPalette = {
      id: editingId || `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: paletteName.trim() || 'Mi paleta',
      baseTheme,
      light: lightColors,
      dark: darkColors,
      createdAt: existing?.createdAt || Date.now(),
    };
    const clean = sanitizeCustomPalettes([candidate])[0];
    if (!clean) return;
    onSaveCustomPalette(clean);
    setEditingId(clean.id);
    setPaletteName(clean.name);
    setLightColors(clean.light);
    setDarkColors(clean.dark);
    setEditorOpen(false);
  };

  return (
    <Modal title="Apariencia" icon={<Palette size={17} />} onClose={onClose} maxWidth="max-w-4xl">
      <p className="text-sm text-ink2 -mt-1 mb-4 leading-relaxed">
        Ocho paletas listas para usar y un editor para crear las tuyas. Todo se aplica al instante y se
        sincroniza en el servidor para este perfil.
      </p>

      <p
        role="status"
        aria-live="polite"
        className={cx(
          'mb-4 rounded-btn border px-3 py-2 text-xs font-semibold',
          syncStatus === 'error' || syncStatus === 'retrying'
            ? 'border-danger/35 bg-danger/10 text-danger'
            : 'border-line bg-sunken/55 text-ink2'
        )}
      >
        {syncStatus === 'synced'
          ? 'Paleta confirmada en el servidor: se conservará al recargar.'
          : syncStatus === 'saving' || syncStatus === 'connecting'
            ? 'Guardando y confirmando la paleta en el servidor…'
            : `La paleta aún no está confirmada en el servidor. ${syncError || 'Se volverá a intentar automáticamente.'}`}
      </p>

      <div
        className={cx(
          'mb-5 rounded-btn border border-line bg-sunken/60 p-2 flex items-center gap-2 transition-opacity',
          isDarkOnly && 'opacity-50 pointer-events-none'
        )}
      >
        <span className="text-xs font-bold text-ink2 px-2">Modo</span>
        <div className="flex gap-1.5 ml-auto">
          <ModeBtn active={!dark} onClick={() => onSetDark(false)} icon={<Sun size={14} />} label="Claro" />
          <ModeBtn active={dark} onClick={() => onSetDark(true)} icon={<Moon size={14} />} label="Oscuro" />
        </div>
      </div>
      {isDarkOnly && (
        <p className="text-xs text-ink3 -mt-3 mb-4">
          El tema integrado «Nocturno» es oscuro por definición; el modo claro no le aplica. Una paleta personalizada con esa base sí puede usar su variante clara.
        </p>
      )}

      <ThemeSectionTitle title="Paletas de Bilifit" detail="Estilos completos, con su tipografía y formas" />
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {THEMES.map((t) => {
          const selected = !activeCustomPalette && theme === t.id;
          const p = t.preview;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSetTheme(t.id)}
              aria-pressed={selected}
              className={cx(
                'text-left rounded-card border-2 p-2.5 transition-all active:scale-[0.99] group',
                selected ? 'border-accent shadow-lift bg-accent/[0.04]' : 'border-line hover:border-line2 bg-surface hover:shadow-lift'
              )}
            >
              <span
                className="block overflow-hidden border"
                style={{ background: p.bg, borderColor: p.line, borderRadius: p.radius }}
                aria-hidden
              >
                <span className="flex items-center gap-1.5 px-2.5 py-2 border-b" style={{ borderColor: p.line, background: p.surface }}>
                  <span className="w-4 h-4 rounded flex items-center justify-center" style={{ background: p.primary, color: p.onPrimary }}>
                    <Activity size={9} strokeWidth={2.6} />
                  </span>
                  <span className="text-[10px] font-bold" style={{ color: p.ink, fontFamily: p.fontDisplay }}>Bilifit</span>
                  <span className="ml-auto w-5 h-2 rounded-full" style={{ background: p.line }} />
                </span>
                <span className="flex gap-2 p-2.5">
                  <span className="flex gap-1 items-end">
                    <span className="w-3.5 h-6 rounded-[2px]" style={{ background: `linear-gradient(160deg, ${p.primary}, ${p.accent2})` }} />
                    <span className="w-3.5 h-4 rounded-[2px]" style={{ background: p.accent2 }} />
                    <span className="w-3.5 h-7 rounded-[2px] opacity-70" style={{ background: p.primary }} />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[10px] font-bold leading-tight" style={{ color: p.ink, fontFamily: p.fontDisplay }}>
                      Entreno de hoy
                    </span>
                    <span className="block h-1.5 w-4/5 rounded-full mt-1.5" style={{ background: p.line }} />
                    <span className="block h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: p.line }}>
                      <span className="block h-full w-2/3" style={{ background: p.primary }} />
                    </span>
                    <span className="inline-block text-[8px] font-bold px-1.5 py-0.5 mt-2" style={{ background: p.primary, color: p.onPrimary, borderRadius: p.radius * 0.6 }}>
                      Ver análisis
                    </span>
                  </span>
                </span>
              </span>

              <span className="flex items-start gap-2 px-1 pt-2.5">
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="font-display font-semibold text-ink text-sm">{t.label}</span>
                    {t.darkOnly && <Moon size={12} className="text-ink3" aria-label="Siempre oscuro" />}
                  </span>
                  <span className="block text-xs text-ink3 leading-snug mt-0.5">{t.tagline}</span>
                </span>
                <SelectedMark selected={selected} />
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-7 flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-[220px]">
          <ThemeSectionTitle title="Tus paletas" detail="Se guardan en el servidor y viajan contigo" compact />
        </div>
        <button type="button" onClick={beginCreate} className={cx(btnPrimary, 'py-2 text-xs')}>
          <Plus size={15} strokeWidth={2.5} /> Nueva paleta
        </button>
      </div>

      {customPalettes.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
          {customPalettes.map((palette) => {
            const colors = dark ? palette.dark : palette.light;
            const selected = activeCustomPalette?.id === palette.id;
            const baseLabel = THEMES.find((item) => item.id === palette.baseTheme)?.label || palette.baseTheme;
            return (
              <div
                key={palette.id}
                className={cx(
                  'relative overflow-hidden rounded-card border-2 bg-surface transition-all',
                  selected ? 'border-accent shadow-lift' : 'border-line hover:border-line2 hover:shadow-lift'
                )}
              >
                <button
                  type="button"
                  onClick={() => onApplyCustomPalette(palette)}
                  aria-pressed={selected}
                  className="block w-full p-3 text-left active:scale-[0.995] transition-transform"
                >
                  <span className="block overflow-hidden rounded-btn border" style={{ background: colors.bg, borderColor: colors.accent }} aria-hidden>
                    <span className="flex items-center gap-2 px-3 py-2" style={{ background: colors.surface, color: colors.ink }}>
                      <span className="flex h-5 w-5 items-center justify-center rounded" style={{ background: colors.primary, color: colors.surface }}>
                        <Activity size={10} strokeWidth={2.6} />
                      </span>
                      <span className="text-[11px] font-extrabold">Bilifit</span>
                      <span className="ml-auto h-2 w-10 rounded-full opacity-25" style={{ background: colors.ink }} />
                    </span>
                    <span className="flex items-end gap-1.5 px-3 py-3">
                      {[colors.primary, colors.accent, colors.accent2, colors.ink].map((color, index) => (
                        <span
                          key={`${color}-${index}`}
                          className="w-7 rounded-[3px] shadow-sm"
                          style={{ background: color, height: index % 2 ? 24 : 32 }}
                        />
                      ))}
                      <span className="ml-auto h-2 flex-1 max-w-24 overflow-hidden rounded-full" style={{ background: `${colors.ink}22` }}>
                        <span className="block h-full w-2/3" style={{ background: colors.primary }} />
                      </span>
                    </span>
                  </span>
                  <span className="flex items-start gap-2 px-1 pt-3">
                    <span className="flex-1 min-w-0">
                      <span className="block truncate font-display text-sm font-semibold text-ink">{palette.name}</span>
                      <span className="mt-0.5 block text-xs text-ink3">Base {baseLabel} · claro y oscuro</span>
                    </span>
                    <SelectedMark selected={selected} />
                  </span>
                </button>

                <div className="absolute z-10 right-3 top-3 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => beginEdit(palette)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-surface/90 text-ink2 shadow-card backdrop-blur transition-all hover:text-ink active:scale-95"
                    aria-label={`Editar ${palette.name}`}
                    title="Editar paleta"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirmingDeleteId === palette.id) {
                        onDeleteCustomPalette(palette.id);
                        setConfirmingDeleteId(null);
                        if (editingId === palette.id) setEditorOpen(false);
                      } else {
                        setConfirmingDeleteId(palette.id);
                      }
                    }}
                    className={cx(
                      'flex h-8 items-center justify-center rounded-full shadow-card backdrop-blur transition-all active:scale-95',
                      confirmingDeleteId === palette.id
                        ? 'bg-danger px-2.5 text-[10px] font-extrabold text-white'
                        : 'w-8 bg-surface/90 text-ink2 hover:text-danger'
                    )}
                    aria-label={`Eliminar ${palette.name}`}
                    title={confirmingDeleteId === palette.id ? 'Pulsa otra vez para eliminar' : 'Eliminar paleta'}
                  >
                    {confirmingDeleteId === palette.id ? '¿Seguro?' : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : !editorOpen ? (
        <button
          type="button"
          onClick={beginCreate}
          className="mt-3 flex w-full items-center gap-3 rounded-card border-2 border-dashed border-line bg-sunken/40 p-4 text-left transition-all hover:border-accent hover:bg-accent/5 active:scale-[0.995]"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-btn bg-accent/10 text-accent">
            <Sparkles size={20} />
          </span>
          <span>
            <span className="block text-sm font-bold text-ink">Crea tu primera paleta</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-ink3">
              Elige seis colores para modo claro y oscuro; Bilifit deriva bordes, gráficos, estados y sombras.
            </span>
          </span>
        </button>
      ) : null}

      {editorOpen && (
        <section
          id="custom-palette-editor"
          ref={editorRef}
          className="mt-4 rounded-card border border-line bg-sunken/45 p-4 sm:p-5"
          aria-labelledby="custom-palette-editor-title"
        >
          <div className="flex items-start gap-3 flex-wrap">
            <span className="flex h-10 w-10 items-center justify-center rounded-btn bg-accent/10 text-accent shrink-0">
              <Sparkles size={19} />
            </span>
            <div className="flex-1 min-w-[210px]">
              <h3 id="custom-palette-editor-title" className="font-display text-base font-semibold text-ink">
                {editingId ? 'Editar paleta' : 'Nueva paleta'}
              </h3>
              <p className="text-xs leading-relaxed text-ink3 mt-0.5">
                Personaliza ambos modos. Al guardar, la paleta se aplica inmediatamente.
              </p>
            </div>
            <div className="flex rounded-full bg-surface p-1 shadow-card" role="group" aria-label="Modo a editar">
              <EditorModeBtn active={editorMode === 'light'} onClick={() => setEditorMode('light')} icon={<Sun size={13} />} label="Claro" />
              <EditorModeBtn active={editorMode === 'dark'} onClick={() => setEditorMode('dark')} icon={<Moon size={13} />} label="Oscuro" />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_220px_auto] gap-3 items-end">
            <label>
              <span className={labelCls}>Nombre</span>
              <input
                value={paletteName}
                onChange={(event) => setPaletteName(event.target.value.slice(0, 40))}
                className={inputCls}
                placeholder="Mi paleta"
              />
            </label>
            <label>
              <span className={labelCls}>Estilo base</span>
              <select value={baseTheme} onChange={(event) => setBaseTheme(event.target.value as ThemeId)} className={cx(selectCls, 'w-full')}>
                {THEMES.map((item) => (
                  <option key={item.id} value={item.id}>{item.label}</option>
                ))}
              </select>
            </label>
            <button type="button" onClick={loadBaseColors} className={cx(btnSoft, 'py-2.5')}>
              <RefreshCw size={13} /> Cargar colores base
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 lg:grid-cols-3 gap-3">
            {COLOR_FIELDS.map((field) => (
              <ColorField
                key={field.key}
                label={field.label}
                hint={field.hint}
                value={editorColors[field.key]}
                onChange={(value) => updateColor(field.key, value)}
              />
            ))}
          </div>

          <div className="mt-4 overflow-hidden rounded-btn border shadow-card" style={{ background: editorColors.bg, borderColor: editorColors.accent }} aria-hidden>
            <div className="flex items-center gap-2 px-3 py-2.5" style={{ background: editorColors.surface, color: editorColors.ink }}>
              <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: editorColors.primary, color: editorColors.surface }}>
                <Activity size={12} strokeWidth={2.5} />
              </span>
              <span className="text-xs font-extrabold">Bilifit</span>
              <span className="ml-auto rounded-full px-2 py-1 text-[9px] font-extrabold" style={{ background: editorColors.primary, color: editorColors.surface }}>
                Entreno
              </span>
            </div>
            <div className="flex items-end gap-2 px-3 py-3">
              {[editorColors.primary, editorColors.accent, editorColors.accent2].map((color, index) => (
                <span key={`${color}-${index}`} className="w-8 rounded-[3px] shadow" style={{ background: `linear-gradient(160deg, ${color}, ${editorColors.ink})`, height: index === 1 ? 34 : 42 }} />
              ))}
              <span className="min-w-0 flex-1 pl-1" style={{ color: editorColors.ink }}>
                <span className="block truncate text-xs font-extrabold">{paletteName.trim() || 'Mi paleta'}</span>
                <span className="mt-2 block h-2 overflow-hidden rounded-full" style={{ background: `${editorColors.ink}22` }}>
                  <span className="block h-full w-[68%]" style={{ background: `linear-gradient(90deg, ${editorColors.primary}, ${editorColors.accent})` }} />
                </span>
              </span>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="button" onClick={generateOppositeMode} className={btnSoft}>
              <Sparkles size={13} />
              {editorMode === 'light' ? 'Generar oscuro desde claro' : 'Generar claro desde oscuro'}
            </button>
            <span className="text-[11px] text-ink3">Puedes retocar después el otro modo.</span>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setEditorOpen(false)} className={cx(btnGhost, 'bg-surface border border-line py-2 text-xs')}>
                Cancelar
              </button>
              <button type="button" onClick={handleSave} disabled={!paletteName.trim()} className={cx(btnPrimary, 'py-2 text-xs')}>
                <Check size={14} strokeWidth={3} /> Guardar y aplicar
              </button>
            </div>
          </div>
        </section>
      )}
    </Modal>
  );
}

function ThemeSectionTitle({ title, detail, compact = false }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={compact ? '' : 'mb-3'}>
      <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
      <p className="text-xs text-ink3 mt-0.5">{detail}</p>
    </div>
  );
}

function SelectedMark({ selected }: { selected: boolean }) {
  return (
    <span
      className={cx(
        'w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 transition-all',
        selected ? 'bg-accent text-white' : 'border-2 border-line2 text-transparent'
      )}
    >
      <Check size={12} strokeWidth={3.2} />
    </span>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="block text-xs font-bold text-ink2">{label}</span>
      <span className="mt-1.5 flex items-center gap-2 rounded-btn border border-line bg-raised p-1.5 shadow-card">
        <input
          type="color"
          value={isHexColor(value) ? value : '#000000'}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-11 shrink-0 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
          aria-label={`Color ${label}`}
        />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.slice(0, 7))}
          className="min-w-0 flex-1 bg-transparent text-[11px] font-extrabold uppercase text-ink outline-none"
          maxLength={7}
          aria-label={`Código de ${label}`}
        />
      </span>
      <span className="mt-1 block truncate text-[10px] text-ink3">{hint}</span>
    </label>
  );
}

function EditorModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-extrabold transition-all active:scale-95',
        active ? 'bg-primary text-onprimary shadow-card' : 'text-ink3 hover:text-ink'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function ModeBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        'inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-bold transition-all active:scale-95',
        active ? 'bg-primary text-onprimary shadow-card' : 'bg-surface text-ink2 border border-line hover:text-ink'
      )}
    >
      {icon}
      {label}
    </button>
  );
}
