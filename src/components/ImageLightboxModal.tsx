'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Loader2, RotateCcw, X } from 'lucide-react';
import { uploadExerciseOrWorkoutImage } from '@/lib/client-image';

export default function ImageLightboxModal({
  open,
  imageUrl,
  title,
  subtitle,
  description,
  canEdit = false,
  canReset = false,
  onClose,
  onImageUpdated,
  onResetImage,
}: {
  open: boolean;
  imageUrl: string | null | undefined;
  title: string;
  subtitle?: string;
  description?: string;
  canEdit?: boolean;
  canReset?: boolean;
  onClose: () => void;
  onImageUpdated?: (nextUrl: string) => Promise<void> | void;
  onResetImage?: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onImageUpdated) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadExerciseOrWorkoutImage(file);
      await onImageUpdated(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir la foto.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/90 backdrop-blur-sm flex flex-col justify-between p-3 sm:p-6 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      {/* Barra superior móvil-friendly */}
      <div
        className="flex items-center justify-between gap-3 max-w-2xl w-full mx-auto pb-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0">
          <h4 className="text-white font-bold text-base sm:text-lg truncate">{title}</h4>
          {subtitle && <p className="text-xs text-slate-300 truncate">{subtitle}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-11 w-11 shrink-0 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
          aria-label="Cerrar imagen"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Imagen principal grande */}
      <div
        className="my-auto flex flex-col items-center justify-center max-w-2xl w-full mx-auto gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        {imageUrl ? (
          <div className="w-full rounded-2xl overflow-hidden border border-white/15 bg-[#161b26] flex items-center justify-center">
            <img
              src={imageUrl}
              alt={title}
              className="w-full max-h-[60dvh] object-contain"
            />
          </div>
        ) : (
          <div className="w-full aspect-square max-h-[45dvh] rounded-2xl border border-dashed border-white/20 bg-white/5 flex flex-col items-center justify-center text-slate-300 text-sm p-6 text-center">
            Sin imagen todavía para este ejercicio.
          </div>
        )}

        {description && (
          <div className="w-full rounded-xl bg-white/10 border border-white/10 px-4 py-3 text-xs sm:text-sm text-slate-100 leading-relaxed">
            {description}
          </div>
        )}

        {error && (
          <div className="w-full rounded-xl bg-rose-500/20 border border-rose-500/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {canEdit && onImageUpdated && (
          <div className="w-full flex flex-wrap items-center justify-center gap-2 pt-1">
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex-1 sm:flex-none min-h-[44px] inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              {uploading ? 'Subiendo...' : imageUrl ? 'Cambiar foto (Cámara / Galería)' : 'Subir foto'}
            </button>
            {canReset && onResetImage && (
              <button
                type="button"
                disabled={uploading}
                onClick={() => void onResetImage()}
                className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-white/10 hover:bg-white/20 px-3.5 py-2.5 text-xs font-semibold text-slate-100"
              >
                <RotateCcw className="h-4 w-4" /> Restaurar guía
              </button>
            )}
          </div>
        )}
      </div>

      <div className="h-2" />
    </div>
  );
}
