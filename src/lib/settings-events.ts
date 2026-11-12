import type { AccountId } from '@/lib/accounts';
import type { AppSettings } from '@/lib/themes';

type SettingsListener = (payload: { type: 'settings'; settings: AppSettings }) => void;

const listenersByAccount = new Map<AccountId, Set<SettingsListener>>();

export function subscribeSettingsEvents(account: AccountId, listener: SettingsListener): () => void {
  let set = listenersByAccount.get(account);
  if (!set) {
    set = new Set();
    listenersByAccount.set(account, set);
  }
  set.add(listener);
  return () => {
    set?.delete(listener);
    if (set && set.size === 0) {
      listenersByAccount.delete(account);
    }
  };
}

export function emitSettingsEvent(account: AccountId, settings: AppSettings): void {
  const set = listenersByAccount.get(account);
  if (!set || set.size === 0) return;
  const payload = { type: 'settings' as const, settings };
  for (const listener of set) {
    try {
      listener(payload);
    } catch {
      // ignore closed stream listener
    }
  }
}
