import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getDb } from '@/lib/db';
import { SETTINGS_SYNC_PROTOCOL } from '@/lib/themes';

export async function GET(req: NextRequest) {
  return withAccount(req, (account) => {
    const db = getDb(account);
    const row = db.prepare('SELECT COUNT(*) as activities FROM activities').get() as { activities: number };
    const settingsRow = db.prepare('SELECT settings_version FROM app_settings WHERE id = 1').get() as
      | { settings_version: number }
      | undefined;
    return NextResponse.json({
      ok: true,
      service: 'bilifit',
      account,
      activities: row.activities,
      settingsVersion: settingsRow?.settings_version ?? 0,
      settingsSyncProtocol: SETTINGS_SYNC_PROTOCOL,
    });
  });
}
