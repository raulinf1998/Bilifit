import { Bike, Dumbbell, Footprints, Mountain, PersonStanding, Zap } from 'lucide-react';
import type { SportType } from '@/types';

export function SportIcon({ sport, className = 'h-4 w-4' }: { sport: SportType; className?: string }) {
  switch (sport) {
    case 'running':
      return <Footprints className={className} />;
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
    running: 'bg-[#fc4c02]/15 text-[#fc4c02] border-[#fc4c02]/30',
    mywhoosh: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    cycling: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    mountain: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    walking: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    strength: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  };

  const labels: Record<SportType, string> = {
    running: 'Correr',
    mywhoosh: 'MyWhoosh',
    cycling: 'Ciclismo',
    mountain: 'Montaña',
    walking: 'Caminar',
    strength: 'Casa / Fuerza',
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[sport]}`}
    >
      <SportIcon sport={sport} className="h-3.5 w-3.5" />
      <span>{subSport || labels[sport]}</span>
    </span>
  );
}
