import { NextResponse } from 'next/server';
import { listGoogleDriveFolders } from '@/lib/huawei-sync';

export async function GET() {
  try {
    const folders = await listGoogleDriveFolders();
    return NextResponse.json({ folders });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'No se pudieron listar las carpetas de Google Drive.' },
      { status: 400 }
    );
  }
}
