import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { listGoogleDriveFolders } from '@/lib/huawei-sync';

export async function GET(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const folders = await listGoogleDriveFolders();
      return NextResponse.json({ folders });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudieron listar las carpetas de Google Drive.' },
        { status: 400 }
      );
    }
  });
}
