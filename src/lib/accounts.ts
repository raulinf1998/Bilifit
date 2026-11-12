export type AccountId = 'raul' | 'pequenaja';

export const ACCOUNT_IDS: readonly AccountId[] = ['raul', 'pequenaja'] as const;

export const ACCOUNT_NAMES: Record<AccountId, string> = {
  raul: 'Raúl',
  pequenaja: 'Pequeñaja',
};

export const ACCOUNT_SUBTITLES: Record<AccountId, string> = {
  raul: 'Perfil principal · Todas tus rutas, MyWhoosh y historial',
  pequenaja: 'Perfil independiente · Su propio progreso y Google Drive',
};

export const ACCOUNT_COOKIE_NAME = 'bilifit-account';

export function normalizeAccountId(value: unknown): AccountId | null {
  return value === 'raul' || value === 'pequenaja' ? value : null;
}

export function otherAccountId(account: AccountId): AccountId {
  return account === 'raul' ? 'pequenaja' : 'raul';
}

export function partnerLabel(account: AccountId): string {
  return `Con ${ACCOUNT_NAMES[otherAccountId(account)]}`;
}

export function parseAccountFromCookieString(cookieHeader: string | null | undefined): AccountId | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ACCOUNT_COOKIE_NAME}=`)) {
      const value = trimmed.slice(ACCOUNT_COOKIE_NAME.length + 1);
      try {
        return normalizeAccountId(decodeURIComponent(value));
      } catch {
        return normalizeAccountId(value);
      }
    }
  }
  return null;
}

export function selectedAccount(): AccountId | null {
  if (typeof document === 'undefined') return null;
  return parseAccountFromCookieString(document.cookie);
}

export function writeAccountCookie(account: AccountId): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ACCOUNT_COOKIE_NAME}=${account}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function selectAccount(account: AccountId, redirectTo?: string): void {
  writeAccountCookie(account);
  if (typeof window === 'undefined') return;
  if (redirectTo) {
    window.location.href = redirectTo;
  } else {
    window.location.reload();
  }
}
