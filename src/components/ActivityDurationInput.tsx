'use client';

import type { DurationFields } from '@/lib/activity-duration';

export default function ActivityDurationInput({ value, onChange }: { value: DurationFields; onChange: (value: DurationFields) => void }) {
  return <fieldset>
    <legend className="block text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Duración</legend>
    <div className="grid grid-cols-3 gap-2">
      {([
        ['hours', 'Horas', 168], ['minutes', 'Minutos', 59], ['seconds', 'Segundos', 59],
      ] as const).map(([key, label, max]) => <label key={key} className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {label}
        <input type="number" required min={0} max={max} step={1} inputMode="numeric" value={value[key]}
          onChange={(event) => onChange({ ...value, [key]: event.target.value })}
          className="mt-1 w-full min-w-0 rounded-lg border px-3 py-2 text-sm tabular-nums"
          style={{ background: 'var(--bg-card-elevated)', borderColor: 'var(--border-subtle)', color: 'var(--text-primary)' }} />
      </label>)}
    </div>
  </fieldset>;
}
