import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { upsertCustomPalette } from '@/lib/db';
import { SETTINGS_SYNC_PROTOCOL, type AppSettings } from '@/lib/themes';

function settingsResponse(settings: AppSettings, status = 200) {
  return NextResponse.json(settings, {
    status,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      Vary: 'Cookie',
      'X-Bilifit-Settings-Version': String(settings.settingsVersion || 0),
      'X-Bilifit-Settings-Protocol': String(SETTINGS_SYNC_PROTOCOL),
    },
  });
}

async function handleSave(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async (account) => {
    const { id } = await context.params;
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    try {
      const { settings } = upsertCustomPalette(id, body, account);
      return settingsResponse(settings);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'La paleta personalizada no es válida.';
      const status = msg.includes('24 paletas') ? 409 : 400;
      return NextResponse.json({ error: msg }, { status });
    }
  });
}

export async function PUT(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleSave(req, context);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleSave(req, context);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return withAccount(req, async (account) => {
    const { id } = await context.params;
    const { deleteCustomPalette } = await import('@/lib/db');
    const { settings } = deleteCustomPalette(id, account);
    return settingsResponse(settings);
  });
}
