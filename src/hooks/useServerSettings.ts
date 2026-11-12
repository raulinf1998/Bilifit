'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { sanitizeCustomPalettes } from '@/lib/theme-palettes';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_SYNC_PROTOCOL,
  VALID_THEMES,
  type AppSettings,
  type CustomPalette,
  type ThemeId,
} from '@/lib/themes';

export type SettingsSyncStatus = 'connecting' | 'synced' | 'saving' | 'retrying' | 'error';

type SettingsPatch = Partial<Pick<AppSettings, 'theme' | 'dark' | 'customPalettes' | 'customPaletteId'>>;

type SettingsWriteOperation =
  | { kind: 'patch'; patch: SettingsPatch }
  | { kind: 'savePalette'; palette: CustomPalette; activate: boolean }
  | { kind: 'deletePalette'; id: string };

interface ApiError extends Error {
  status?: number;
}

const SETTINGS_SYNC_INTERVAL_MS = 15_000;
const SETTINGS_RETRY_BASE_MS = 1_000;
const SETTINGS_RETRY_MAX_MS = 30_000;

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data?.error) message = data.error;
    } catch {
      // ignore non-json
    }
    const err = new Error(message) as ApiError;
    err.status = res.status;
    throw err;
  }

  return (await res.json()) as T;
}

async function putWithPostFallback<T>(url: string, body: unknown): Promise<T> {
  try {
    return await fetchJson<T>(url, { method: 'PUT', body: JSON.stringify(body) });
  } catch (err) {
    const status = (err as ApiError)?.status;
    if (status === 405 || status === 501) {
      return fetchJson<T>(url, { method: 'POST', body: JSON.stringify(body) });
    }
    throw err;
  }
}

export function normalizeServerSettings(value: unknown): AppSettings | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<AppSettings>;
  if (
    typeof candidate.dark !== 'boolean' ||
    typeof candidate.theme !== 'string' ||
    !VALID_THEMES.includes(candidate.theme as ThemeId) ||
    !Array.isArray(candidate.customPalettes) ||
    !Number.isSafeInteger(candidate.settingsVersion) ||
    (candidate.settingsVersion as number) < 0
  ) {
    return null;
  }

  const palettes = sanitizeCustomPalettes(candidate.customPalettes);
  return {
    theme: candidate.theme as ThemeId,
    dark: Boolean(candidate.dark),
    customPalettes: palettes,
    customPaletteId:
      candidate.customPaletteId && palettes.some((p) => p.id === candidate.customPaletteId)
        ? candidate.customPaletteId
        : null,
    settingsVersion:
      typeof candidate.settingsVersion === 'number' && candidate.settingsVersion > 0
        ? candidate.settingsVersion
        : 0,
    settingsSyncProtocol:
      typeof candidate.settingsSyncProtocol === 'number' && candidate.settingsSyncProtocol > 0
        ? candidate.settingsSyncProtocol
        : 0,
  };
}

function embeddedServerSettings(): AppSettings | null {
  if (typeof window === 'undefined') return null;
  const raw = (window as Window & { __BILIFIT_SETTINGS__?: unknown }).__BILIFIT_SETTINGS__;
  return normalizeServerSettings(raw);
}

function settingsErrorMessage(error: unknown): string {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return 'Sin conexión con el servidor. Se reintentará automáticamente al volver la red.';
  }
  if (error instanceof Error && error.message.trim()) return error.message;
  return 'No se pudo confirmar el guardado con el servidor.';
}

export function useServerSettings(ssrInitial?: AppSettings | null) {
  const [initialServerSettings] = useState<AppSettings>(() => {
    const fromSsr = normalizeServerSettings(ssrInitial);
    if (fromSsr) return fromSsr;
    return embeddedServerSettings() ?? { ...DEFAULT_APP_SETTINGS };
  });

  const [dark, setDarkState] = useState<boolean>(initialServerSettings.dark);
  const [theme, setThemeState] = useState<ThemeId>(initialServerSettings.theme);
  const [customPalettes, setCustomPalettesState] = useState<CustomPalette[]>(
    initialServerSettings.customPalettes
  );
  const [customPaletteId, setCustomPaletteIdState] = useState<string | null>(
    initialServerSettings.customPaletteId
  );
  const [settingsVersion, setSettingsVersionState] = useState<number>(
    initialServerSettings.settingsVersion
  );
  const [settingsSyncStatus, setSettingsSyncStatus] = useState<SettingsSyncStatus>('connecting');
  const [settingsSyncError, setSettingsSyncError] = useState<string | null>(null);
  const [settingsLastSyncedAt, setSettingsLastSyncedAt] = useState<number | null>(null);

  const settingsVersionRef = useRef(initialServerSettings.settingsVersion);
  const appliedFingerprintRef = useRef(JSON.stringify(initialServerSettings));
  const localMutationRef = useRef(0);
  const confirmedSettingsRef = useRef<AppSettings>(initialServerSettings);
  const writeQueueRef = useRef<SettingsWriteOperation[]>([]);
  const writeInFlightRef = useRef(false);
  const activeWriteOperationRef = useRef<SettingsWriteOperation | null>(null);
  const writeRetryTimerRef = useRef<number | null>(null);
  const writeRetryAttemptRef = useRef(0);
  const rejectedWriteRef = useRef(false);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshSettingsRef = useRef<(force?: boolean) => Promise<void>>(async () => {});
  const processWriteQueueRef = useRef<() => Promise<void>>(async () => {});

  const hasPendingWrites = useCallback(
    (): boolean => writeInFlightRef.current || writeQueueRef.current.length > 0,
    []
  );

  const noteServerSettings = useCallback(
    (settings: AppSettings): AppSettings | null => {
      const normalized = normalizeServerSettings(settings);
      if (!normalized) return null;
      if (normalized.settingsVersion < settingsVersionRef.current) return null;

      confirmedSettingsRef.current = normalized;
      settingsVersionRef.current = Math.max(settingsVersionRef.current, normalized.settingsVersion);
      setSettingsVersionState(settingsVersionRef.current);
      setSettingsLastSyncedAt(Date.now());

      if ((normalized.settingsSyncProtocol || 0) < SETTINGS_SYNC_PROTOCOL) {
        setSettingsSyncError(
          'El servidor respondió sin el protocolo actual de sincronización; se reintentará automáticamente.'
        );
        if (!hasPendingWrites()) setSettingsSyncStatus('error');
      } else if (!hasPendingWrites() && !rejectedWriteRef.current) {
        setSettingsSyncError(null);
        setSettingsSyncStatus('synced');
      }
      return normalized;
    },
    [hasPendingWrites]
  );

  const applySettings = useCallback(
    (settings: AppSettings, force = false): boolean => {
      const normalized = noteServerSettings(settings);
      if (!normalized) return false;

      const fingerprint = JSON.stringify(normalized);
      if (!force && appliedFingerprintRef.current === fingerprint) return false;
      appliedFingerprintRef.current = fingerprint;

      setDarkState(normalized.dark);
      setThemeState(normalized.theme);
      setCustomPalettesState(normalized.customPalettes);
      setCustomPaletteIdState(normalized.customPaletteId);
      return true;
    },
    [noteServerSettings]
  );

  const beginLocalMutation = useCallback((): number => {
    localMutationRef.current += 1;
    rejectedWriteRef.current = false;
    setSettingsSyncError(null);
    setSettingsSyncStatus('saving');
    return localMutationRef.current;
  }, []);

  const clearWriteRetryTimer = useCallback(() => {
    if (writeRetryTimerRef.current) {
      window.clearTimeout(writeRetryTimerRef.current);
      writeRetryTimerRef.current = null;
    }
  }, []);

  const scheduleWriteRetry = useCallback(() => {
    if (writeRetryTimerRef.current) return;
    const delay = Math.min(
      SETTINGS_RETRY_MAX_MS,
      SETTINGS_RETRY_BASE_MS * 2 ** writeRetryAttemptRef.current
    );
    writeRetryAttemptRef.current += 1;
    writeRetryTimerRef.current = window.setTimeout(() => {
      writeRetryTimerRef.current = null;
      void processWriteQueueRef.current();
    }, delay);
  }, []);

  const executeWriteOperation = useCallback((operation: SettingsWriteOperation): Promise<AppSettings> => {
    if (operation.kind === 'patch') {
      return putWithPostFallback<AppSettings>('/api/settings', operation.patch);
    }
    if (operation.kind === 'savePalette') {
      return putWithPostFallback<AppSettings>(
        `/api/settings/custom-palettes/${encodeURIComponent(operation.palette.id)}`,
        { palette: operation.palette, activate: operation.activate }
      );
    }
    return fetchJson<AppSettings>(
      `/api/settings/custom-palettes/${encodeURIComponent(operation.id)}`,
      { method: 'DELETE' }
    );
  }, []);

  const processWriteQueue = useCallback(async (): Promise<void> => {
    if (writeInFlightRef.current) return;
    if (!writeQueueRef.current.length) {
      if (
        !rejectedWriteRef.current &&
        (confirmedSettingsRef.current.settingsSyncProtocol || 0) >= SETTINGS_SYNC_PROTOCOL
      ) {
        setSettingsSyncError(null);
        setSettingsSyncStatus('synced');
      }
      return;
    }

    clearWriteRetryTimer();
    writeInFlightRef.current = true;
    setSettingsSyncStatus('saving');

    while (writeQueueRef.current.length) {
      const operation = writeQueueRef.current[0];
      activeWriteOperationRef.current = operation;
      try {
        const saved = await executeWriteOperation(operation);
        const normalizedSaved = normalizeServerSettings(saved);
        if (!normalizedSaved) throw new Error('El servidor no confirmó los ajustes guardados.');

        const expectedPaletteId =
          operation.kind === 'savePalette' && operation.activate
            ? operation.palette.id
            : operation.kind === 'patch'
              ? operation.patch.customPaletteId
              : undefined;
        const expectedTheme = operation.kind === 'patch' ? operation.patch.theme : undefined;
        if (
          (expectedPaletteId !== undefined && normalizedSaved.customPaletteId !== expectedPaletteId) ||
          (expectedTheme !== undefined && normalizedSaved.theme !== expectedTheme)
        ) {
          throw new Error('El servidor no confirmó la paleta seleccionada. Se reintentará automáticamente.');
        }

        if (writeQueueRef.current[0] === operation) writeQueueRef.current.shift();
        else writeQueueRef.current = writeQueueRef.current.filter((item) => item !== operation);
        activeWriteOperationRef.current = null;
        writeRetryAttemptRef.current = 0;

        const confirmed = noteServerSettings(saved);
        if (confirmed && !writeQueueRef.current.length) applySettings(confirmed, true);
      } catch (error) {
        activeWriteOperationRef.current = null;
        writeInFlightRef.current = false;
        const status = (error as ApiError)?.status;
        const permanent = status === 400 || status === 409 || status === 422;
        setSettingsSyncError(settingsErrorMessage(error));

        if (permanent) {
          rejectedWriteRef.current = true;
          if (writeQueueRef.current[0] === operation) writeQueueRef.current.shift();
          else writeQueueRef.current = writeQueueRef.current.filter((item) => item !== operation);
          appliedFingerprintRef.current = '';
          setSettingsSyncStatus('error');
          void refreshSettingsRef.current(true);
          if (writeQueueRef.current.length) void processWriteQueueRef.current();
          return;
        }

        setSettingsSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'error' : 'retrying');
        scheduleWriteRetry();
        return;
      }
    }

    writeInFlightRef.current = false;
    if ((confirmedSettingsRef.current.settingsSyncProtocol || 0) >= SETTINGS_SYNC_PROTOCOL) {
      setSettingsSyncError(null);
      setSettingsSyncStatus('synced');
    } else {
      setSettingsSyncStatus('error');
    }
    void refreshSettingsRef.current();
  }, [applySettings, clearWriteRetryTimer, executeWriteOperation, noteServerSettings, scheduleWriteRetry]);

  useEffect(() => {
    processWriteQueueRef.current = processWriteQueue;
  }, [processWriteQueue]);

  const enqueueWriteOperation = useCallback((operation: SettingsWriteOperation) => {
    if (operation.kind === 'patch') {
      const last = writeQueueRef.current[writeQueueRef.current.length - 1];
      if (last?.kind === 'patch' && last !== activeWriteOperationRef.current) {
        last.patch = { ...last.patch, ...operation.patch };
        void processWriteQueueRef.current();
        return;
      }
    }
    writeQueueRef.current.push(operation);
    void processWriteQueueRef.current();
  }, []);

  const refreshSettings = useCallback(
    async (force = false): Promise<void> => {
      if (refreshInFlightRef.current) return refreshInFlightRef.current;

      const mutationAtStart = localMutationRef.current;
      const request = (async () => {
        try {
          const serverSettings = await fetchJson<AppSettings>('/api/settings');
          if (!normalizeServerSettings(serverSettings)) {
            throw new Error('El servidor devolvió unos ajustes no válidos.');
          }
          const confirmed = noteServerSettings(serverSettings);
          if (!confirmed) return;

          if (localMutationRef.current === mutationAtStart && !hasPendingWrites()) {
            applySettings(confirmed, force);
          }
        } catch (error) {
          if (!hasPendingWrites()) {
            setSettingsSyncError(settingsErrorMessage(error));
            setSettingsSyncStatus(typeof navigator !== 'undefined' && !navigator.onLine ? 'error' : 'retrying');
          }
        }
      })();

      refreshInFlightRef.current = request;
      void request.finally(() => {
        if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
      });
      return request;
    },
    [applySettings, hasPendingWrites, noteServerSettings]
  );

  useEffect(() => {
    refreshSettingsRef.current = refreshSettings;
  }, [refreshSettings]);

  useEffect(() => {
    void processWriteQueueRef.current();
    void refreshSettings();

    let eventSource: EventSource | null = null;
    if (typeof EventSource !== 'undefined') {
      eventSource = new EventSource('/api/settings/events');
      eventSource.addEventListener('settings', (event) => {
        try {
          const parsed = JSON.parse((event as MessageEvent<string>).data) as AppSettings;
          const confirmed = noteServerSettings(parsed);
          if (confirmed && !hasPendingWrites()) applySettings(confirmed);
        } catch {
          void refreshSettings();
        }
      });
      eventSource.addEventListener('open', () => {
        void processWriteQueueRef.current();
        void refreshSettings();
      });
      eventSource.addEventListener('error', () => {
        if (!hasPendingWrites()) {
          setSettingsSyncStatus((prev) => (prev === 'synced' ? 'retrying' : prev));
        }
      });
    }

    const syncIfVisible = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        clearWriteRetryTimer();
        writeRetryAttemptRef.current = 0;
        void processWriteQueueRef.current();
        void refreshSettings();
      }
    };
    const interval = window.setInterval(syncIfVisible, SETTINGS_SYNC_INTERVAL_MS);
    window.addEventListener('focus', syncIfVisible);
    window.addEventListener('online', syncIfVisible);
    document.addEventListener('visibilitychange', syncIfVisible);

    return () => {
      eventSource?.close();
      clearWriteRetryTimer();
      window.clearInterval(interval);
      window.removeEventListener('focus', syncIfVisible);
      window.removeEventListener('online', syncIfVisible);
      document.removeEventListener('visibilitychange', syncIfVisible);
    };
  }, [applySettings, clearWriteRetryTimer, hasPendingWrites, noteServerSettings, refreshSettings]);

  const setDark = useCallback(
    (d: boolean) => {
      beginLocalMutation();
      setDarkState(d);
      enqueueWriteOperation({ kind: 'patch', patch: { dark: d } });
    },
    [beginLocalMutation, enqueueWriteOperation]
  );

  const setTheme = useCallback(
    (t: ThemeId) => {
      beginLocalMutation();
      setThemeState(t);
      setCustomPaletteIdState(null);
      enqueueWriteOperation({ kind: 'patch', patch: { theme: t, customPaletteId: null } });
    },
    [beginLocalMutation, enqueueWriteOperation]
  );

  const applyCustomPalette = useCallback(
    (palette: CustomPalette) => {
      beginLocalMutation();
      setThemeState(palette.baseTheme);
      setCustomPaletteIdState(palette.id);
      enqueueWriteOperation({
        kind: 'patch',
        patch: { theme: palette.baseTheme, customPaletteId: palette.id },
      });
    },
    [beginLocalMutation, enqueueWriteOperation]
  );

  const saveCustomPalette = useCallback(
    (palette: CustomPalette) => {
      const clean = sanitizeCustomPalettes([palette])[0];
      if (!clean) return;
      beginLocalMutation();
      setCustomPalettesState((prev) =>
        prev.some((item) => item.id === clean.id)
          ? prev.map((item) => (item.id === clean.id ? clean : item))
          : [clean, ...prev]
      );
      setThemeState(clean.baseTheme);
      setCustomPaletteIdState(clean.id);
      enqueueWriteOperation({ kind: 'savePalette', palette: clean, activate: true });
    },
    [beginLocalMutation, enqueueWriteOperation]
  );

  const deleteCustomPalette = useCallback(
    (id: string) => {
      beginLocalMutation();
      setCustomPalettesState((prev) => prev.filter((p) => p.id !== id));
      setCustomPaletteIdState((prev) => (prev === id ? null : prev));
      enqueueWriteOperation({ kind: 'deletePalette', id });
    },
    [beginLocalMutation, enqueueWriteOperation]
  );

  const activeCustomPalette = customPalettes.find((p) => p.id === customPaletteId) || null;

  return {
    dark,
    setDark,
    theme,
    setTheme,
    customPalettes,
    customPaletteId,
    activeCustomPalette,
    applyCustomPalette,
    saveCustomPalette,
    deleteCustomPalette,
    settingsVersion,
    settingsSyncStatus,
    settingsSyncError,
    settingsLastSyncedAt,
    refreshSettings,
  };
}
