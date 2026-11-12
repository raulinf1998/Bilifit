import { Bike, Dumbbell, Footprints, Mountain, PersonStanding, Zap } from 'lucide-react';
import { resolveDisplaySubSport } from '@/lib/metrics';
import type { SportType } from '@/types';

function TrailRunningIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      {/* Silueta de montaña al fondo */}
      <path
        d="M2.5 11.5 L7.5 3.2 L11.8 9 L16 3.8 L21.5 11.5 Z"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <path
        d="M2.5 11.5 L7.5 3.2 L11.8 9 L16 3.8 L21.5 11.5"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Zapatilla deportiva de trail con tacos */}
      <path
        d="M3.5 14.2 L5.5 13.4 L7.6 14.9 L10.6 13.4 L16 16.4 L20.2 17.1 C21.2 17.3 21.4 18.8 20.4 19.8 L19.6 20.5 H4.2 C3.4 20.5 3 19.7 3.2 18.6 Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M3.4 18.4 H20.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <path
        d="M6.5 20.6 V21.8 M10.2 20.6 V21.8 M14 20.6 V21.8 M17.7 20.6 V21.8"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M12.2 14.3 L13.4 13 M14.4 15.5 L15.6 14.2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function SportIcon({ sport, className = 'h-4 w-4' }: { sport: SportType; className?: string }) {
  switch (sport) {
    case 'running':
      return <Footprints className={className} />;
    case 'trail':
      return <TrailRunningIcon className={className} />;
    case 'mywhoosh':
      return <Zap className={className} />;
    case 'cycling':
      return <Bike className={className} />;
    case 'mountain':
      return <Mountain className={className} />;
    case 'walking':
      return <PersonStanding className={className} />;
    case 'strength':
      return <Dumbbell className={className} />;
  }
}

export function SportBadge({ sport, subSport }: { sport: SportType; subSport?: string | null }) {
  const styles: Record<SportType, string> = {
    running: 'bg-primary/15 text-primary border-primary/30',
    trail: 'bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/30',
    mywhoosh: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
    cycling: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
    mountain: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
    walking: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    strength: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  };

  const labels: Record<SportType, string> = {
    running: 'Correr',
    trail: 'Trail Running',
    mywhoosh: 'MyWhoosh',
    cycling: 'Ciclismo',
    mountain: 'Senderismo',
    walking: 'Caminar',
    strength: 'Casa / Fuerza',
  };

  const displayLabel = resolveDisplaySubSport(sport, subSport) || labels[sport];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[sport]}`}
    >
      <SportIcon sport={sport} className="h-3.5 w-3.5" />
      <span>{displayLabel}</span>
    </span>
  );
}
