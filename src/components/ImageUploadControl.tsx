'use client';

import { useRef, useState } from 'react';
import { Camera, Link2, Loader2, Trash2 } from 'lucide-react';
import { uploadExerciseOrWorkoutImage } from '@/lib/client-image';

export default function ImageUploadControl({
  value,
  onChange,
  label = 'Imagen',
  compact = false,
}: {
  value: string | null | undefined;
  onChange: (nextUrl: string | null) => void;
  label?: string;
  compact?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const url = await uploadExerciseOrWorkoutImage(file);
      onChange(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error subiendo imagen.');
    } finally {
      setUploading(false);
    }
  }

  function applyUrl() {
    const trimmed = urlDraft.trim();
    if (!trimmed) return;
    if (!/^(\/|https?:\/\/|data:image\/)/i.test(trimmed)) {
      setError('Introduce una URL válida (https://... o /...).');
      return;
    }
    setError(null);
    onChange(trimmed);
    setUrlDraft('');
    setShowUrlInput(false);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2.5">
        {value && (
          <div className="relative h-14 w-14 rounded-xl overflow-hidden border shrink-0 bg-[#161b26]" style={{ borderColor: 'var(--border-subtle)' }}>
            <img src={value} alt={label} className="h-full w-full object-cover" />
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFile}
        />

        <div className="flex flex-wrap items-center gap-1.5 flex-1 min-w-0">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className={`inline-flex items-center gap-1.5 rounded-xl border font-semibold hover:bg-sunken transition-colors ${
              compact ? 'px-2.5 py-1.5 text-xs min-h-[36px]' : 'px-3 py-2 text-xs min-h-[40px]'
            }`}
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5 text-purple-400" />}
            {uploading ? 'Subiendo...' : value ? 'Cambiar foto' : `Subir ${label.toLowerCase()}`}
          </button>

          <button
            type="button"
            onClick={() => setShowUrlInput((s) => !s)}
            className="inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-medium hover:bg-sunken min-h-[36px]"
            style={{ borderColor: 'var(--border-subtle)' }}
            title="Pegar enlace URL de imagen"
          >
            <Link2 className="h-3.5 w-3.5" /> URL
          </button>

          {value && (
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex items-center gap-1 rounded-xl border border-rose-500/30 px-2.5 py-1.5 text-xs font-medium text-rose-500 hover:bg-rose-500/10 min-h-[36px]"
              title="Quitar imagen"
            >
              <Trash2 className="h-3.5 w-3.5" /> Quitar
            </button>
          )}
        </div>
      </div>

      {showUrlInput && (
        <div className="flex items-center gap-2">
          <input
            type="url"
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="https://... enlace de la imagen"
            className="flex-1 min-w-0 rounded-lg border px-3 py-2 text-base sm:text-xs"
            style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
          />
          <button
            type="button"
            onClick={applyUrl}
            className="rounded-lg bg-purple-600 px-3 py-2 text-xs font-semibold text-white shrink-0 min-h-[38px]"
          >
            Usar
          </button>
        </div>
      )}

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}
