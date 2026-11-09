'use client';

import { useState } from 'react';
import { CheckCircle2, FileUp, Loader2, AlertCircle } from 'lucide-react';
import type { SportType } from '@/types';

export default function ActivityImporter({ onImported }: { onImported?: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [sportOverride, setSportOverride] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (files.length === 0) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      if (sportOverride) fd.append('sportOverride', sportOverride as SportType);

      const res = await fetch('/api/import', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Error al importar');
      } else {
        setResult(data);
        setFiles([]);
        onImported?.();
      }
    } catch {
      setError('No se pudo conectar con el servidor para importar.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <label
        className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center cursor-pointer hover:border-[#fc4c02] transition-colors"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-card-elevated)' }}
      >
        <FileUp className="h-8 w-8 text-[#fc4c02] mb-2" />
        <div className="text-sm font-semibold">
          {files.length > 0
            ? `${files.length} archivo(s) seleccionado(s): ${files.map((f) => f.name).join(', ')}`
            : 'Arrastra o haz clic para subir .FIT, .GPX (MyWhoosh/GPS), .TCX o .ZIP de Strava'}
        </div>
        <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          Compatible con archivos GPX con vatios de MyWhoosh, relojes Garmin/Coros/Suunto y exportaciones ZIP de Strava
        </div>
        <input
          type="file"
          multiple
          accept=".fit,.gpx,.tcx,.zip,.gz,.xml"
          className="hidden"
          onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>
            Detección de deporte (opcional)
          </label>
          <select
            value={sportOverride}
            onChange={(e) => setSportOverride(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)' }}
          >
            <option value="">Automático (detectar MyWhoosh, Montaña, Correr, Bici)</option>
            <option value="running">Forzar: Correr</option>
            <option value="mywhoosh">Forzar: MyWhoosh / Bici Indoor</option>
            <option value="mountain">Forzar: Montaña / Trail / Senderismo</option>
            <option value="cycling">Forzar: Bici Carretera / MTB</option>
            <option value="strength">Forzar: Fuerza</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={files.length === 0 || loading}
          className="mt-4 sm:mt-5 inline-flex items-center gap-2 rounded-xl bg-[#fc4c02] hover:bg-[#e54400] disabled:opacity-50 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
          {loading ? 'Procesando...' : 'Importar archivos'}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-300">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {result && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs space-y-1 text-emerald-300">
          <div className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            <span>
              Importadas {result.imported} actividad(es) · Omitidas por duplicado: {result.skipped}
            </span>
          </div>
          {result.errors.length > 0 && (
            <div className="text-amber-300 pl-6">Avisos: {result.errors.join(' | ')}</div>
          )}
        </div>
      )}
    </form>
  );
}
