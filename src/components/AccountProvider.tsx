'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { AccountId } from '@/lib/accounts';

const AccountContext = createContext<AccountId>('raul');

export function AccountProvider({
  account,
  children,
}: {
  account: AccountId;
  children: ReactNode;
}) {
  return <AccountContext.Provider value={account}>{children}</AccountContext.Provider>;
}

export function useActiveAccount(): AccountId {
  return useContext(AccountContext);
}
