import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextRequest } from 'next/server';
import { normalizeAccountId, parseAccountFromCookieString, type AccountId } from '@/lib/accounts';

const accountStorage = new AsyncLocalStorage<AccountId>();

export function currentAccountId(): AccountId {
  return accountStorage.getStore() ?? 'raul';
}

export function runWithAccount<T>(account: AccountId, fn: () => T): T {
  return accountStorage.run(account, fn);
}

export function getAccountFromRequest(req: NextRequest): AccountId {
  const fromCookie = normalizeAccountId(req.cookies.get('bilifit-account')?.value);
  if (fromCookie) return fromCookie;
  const fromHeader = parseAccountFromCookieString(req.headers.get('cookie'));
  return fromHeader ?? 'raul';
}

export function withAccount<T>(req: NextRequest, fn: (account: AccountId) => T | Promise<T>): Promise<T> {
  const account = getAccountFromRequest(req);
  return Promise.resolve(accountStorage.run(account, () => fn(account)));
}
