'use client';

import { Heart, Loader2 } from 'lucide-react';
import { useActiveAccount } from '@/components/AccountProvider';
import { cx } from '@/components/ui';
import type { AccountId } from '@/lib/accounts';

export function getTogetherLabel(account: AccountId): string {
  return account === 'pequenaja' ? 'Con Raúl' : 'Con Pequeñaja';
}

export function TogetherBadge({ className }: { className?: string }) {
  const account = useActiveAccount();
  const label = getTogetherLabel(account);

  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300',
        className
      )}
    >
      <Heart className="h-3 w-3 fill-current shrink-0" />
      <span>{label}</span>
    </span>
  );
}

export function TogetherToggleButton({
  active,
  busy = false,
  onClick,
  compact = false,
  className,
}: {
  active: boolean;
  busy?: boolean;
  onClick: () => void;
  compact?: boolean;
  className?: string;
}) {
  const account = useActiveAccount();
  const label = getTogetherLabel(account);

  return (
    <button
      type="button"
      disabled={busy}
      aria-pressed={active}
      onClick={onClick}
      title={active ? `Quitar etiqueta «${label}»` : `Marcar como realizada ${label.toLowerCase()}`}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border font-semibold transition-all active:scale-95 disabled:opacity-60',
        compact ? 'px-2.5 py-1 text-[11px]' : 'px-3.5 py-2 text-xs',
        active
          ? 'border-rose-500 bg-rose-500 text-white shadow-sm hover:bg-rose-600'
          : 'border-line bg-surface text-ink2 hover:border-rose-500/40 hover:text-rose-600 dark:hover:text-rose-300 hover:bg-rose-500/10',
        className
      )}
    >
      {busy ? (
        <Loader2 className={cx(compact ? 'h-3 w-3' : 'h-3.5 w-3.5', 'animate-spin shrink-0')} />
      ) : (
        <Heart className={cx(compact ? 'h-3 w-3' : 'h-3.5 w-3.5', active && 'fill-current', 'shrink-0')} />
      )}
      <span>{label}</span>
    </button>
  );
}
