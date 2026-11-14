'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Devuelve un "tick" visual temporal por clave (por ejemplo, al pulsar + Añadir en un ejercicio).
 *
 * `flash(key)` activa la marca durante `durationMs` y `isFlashing(key)` permite pintar el check.
 * Los timers se limpian al desmontar para no actualizar estado de un componente ya cerrado.
 */
export function useAddTick(durationMs = 2200) {
  const [tickedKeys, setTickedKeys] = useState<Record<string, number>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const flash = useCallback(
    (key: string) => {
      const stamp = Date.now();
      setTickedKeys((prev) => ({ ...prev, [key]: stamp }));

      const previous = timersRef.current[key];
      if (previous) clearTimeout(previous);

      timersRef.current[key] = setTimeout(() => {
        delete timersRef.current[key];
        setTickedKeys((prev) => {
          if (!prev[key]) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, durationMs);
    },
    [durationMs]
  );

  const clearFlash = useCallback((key: string) => {
    const previous = timersRef.current[key];
    if (previous) clearTimeout(previous);
    delete timersRef.current[key];
    setTickedKeys((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  /** Cancela todos los destellos (p. ej. al reindexar las filas de una lista). */
  const clearAll = useCallback(() => {
    Object.values(timersRef.current).forEach((t) => clearTimeout(t));
    timersRef.current = {};
    setTickedKeys((prev) => (Object.keys(prev).length === 0 ? prev : {}));
  }, []);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      Object.values(timers).forEach((t) => clearTimeout(t));
    };
  }, []);

  const isFlashing = useCallback((key: string) => Boolean(tickedKeys[key]), [tickedKeys]);

  return { flash, clearFlash, clearAll, isFlashing };
}
