declare global {
  var __bilifitSyncTimer: ReturnType<typeof setInterval> | undefined;
}

export async function register() {
  if (
    process.env.NEXT_RUNTIME !== 'nodejs' ||
    process.env.NEXT_PHASE === 'phase-production-build' ||
    process.env.BILIFIT_DISABLE_SCHEDULER === '1'
  ) {
    return;
  }

  if (globalThis.__bilifitSyncTimer) {
    return;
  }

  const runCheck = async () => {
    const { ACCOUNT_IDS } = await import('@/lib/accounts');
    const { runWithAccount } = await import('@/lib/account-context');

    for (const account of ACCOUNT_IDS) {
      try {
        const { runScheduledMyWhooshSyncIfDue } = await import('@/lib/mywhoosh-sync');
        await runWithAccount(account, () => runScheduledMyWhooshSyncIfDue());
      } catch {
        // Silenciar fallos de red puntuales en el cron en segundo plano
      }

      try {
        const { runScheduledHuaweiSyncIfDue } = await import('@/lib/huawei-sync');
        await runWithAccount(account, () => runScheduledHuaweiSyncIfDue());
      } catch {
        // Silenciar fallos puntuales de carpeta/Drive en segundo plano
      }
    }
  };

  setTimeout(() => {
    void runCheck();
  }, 15_000).unref();

  globalThis.__bilifitSyncTimer = setInterval(() => {
    void runCheck();
  }, 60_000);
  globalThis.__bilifitSyncTimer.unref();
}
