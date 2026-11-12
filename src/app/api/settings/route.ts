import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { getAppSettings, updateAppSettings } from '@/lib/db';
import { sanitizeCustomPalettes } from '@/lib/theme-palettes';
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

export async function GET(req: NextRequest) {
  return withAccount(req, (account) => {
    const settings = getAppSettings(account);
    return settingsResponse(settings);
  });
}

async function handlePatch(req: NextRequest) {
  return withAccount(req, async (account) => {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const current = getAppSettings(account);
    const requestedPalettes = Array.isArray(body.customPalettes)
      ? sanitizeCustomPalettes(body.customPalettes)
      : current.customPalettes;

    if (
      typeof body.customPaletteId === 'string' &&
      body.customPaletteId.trim() !== '' &&
      !requestedPalettes.some((p) => p.id === body.customPaletteId)
    ) {
      return NextResponse.json(
        { error: 'Esta paleta ya no está guardada en el servidor. Actualiza la lista de paletas.' },
        { status: 409 }
      );
    }

    const updated = updateAppSettings(
      {
        theme: body.theme,
        dark: body.dark,
        customPalettes: Array.isArray(body.customPalettes) ? body.customPalettes : undefined,
        customPaletteId: body.customPaletteId,
      },
      account
    );

    return settingsResponse(updated);
  });
}

export async function PUT(req: NextRequest) {
  return handlePatch(req);
}

export async function POST(req: NextRequest) {
  return handlePatch(req);
}
