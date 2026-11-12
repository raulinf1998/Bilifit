import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getHuaweiStatus, updateHuaweiPreferences } from '@/lib/huawei-sync';

function baseUrlFromReq(req: NextRequest): string {
  const proto = req.headers.get('x-forwarded-proto') || (req.nextUrl.protocol ? req.nextUrl.protocol.replace(':', '') : 'http');
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3000';
  return `${proto}://${host}`;
}

export async function GET(req: NextRequest) {
  return withAccount(req, () =>
    NextResponse.json({
      status: getHuaweiStatus(baseUrlFromReq(req)),
    })
  );
}

export async function PATCH(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const body = (await req.json().catch(() => ({}))) as {
        watchDir?: string;
        googleClientId?: string;
        googleClientSecret?: string;
        driveFolderId?: string | null;
        driveFolderName?: string | null;
        autoSyncEnabled?: boolean;
        syncIntervalMin?: number;
      };

      updateHuaweiPreferences(body);
      return NextResponse.json({
        ok: true,
        status: getHuaweiStatus(baseUrlFromReq(req)),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'Error guardando configuración de Huawei Health.' },
        { status: 400 }
      );
    }
  });
}
