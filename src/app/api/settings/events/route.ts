import { NextRequest } from 'next/server';
import { getAccountFromRequest } from '@/lib/account-context';
import { getAppSettings } from '@/lib/db';
import { subscribeSettingsEvents } from '@/lib/settings-events';
import { SETTINGS_SYNC_PROTOCOL } from '@/lib/themes';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const account = getAccountFromRequest(req);
  const initial = getAppSettings(account);
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const sendSettings = (settings: typeof initial) => {
        try {
          controller.enqueue(encoder.encode(`event: settings\ndata: ${JSON.stringify(settings)}\n\n`));
        } catch {
          // stream closed
        }
      };

      sendSettings(initial);

      const unsubscribe = subscribeSettingsEvents(account, (payload) => {
        sendSettings(payload.settings);
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 25_000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };

      req.signal.addEventListener('abort', () => {
        cleanup?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      Connection: 'keep-alive',
      Vary: 'Cookie',
      'X-Accel-Buffering': 'no',
      'X-Bilifit-Settings-Version': String(initial.settingsVersion || 0),
      'X-Bilifit-Settings-Protocol': String(SETTINGS_SYNC_PROTOCOL),
    },
  });
}
