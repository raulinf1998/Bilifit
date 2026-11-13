import { NextRequest, NextResponse } from 'next/server';
import { withAccount } from '@/lib/account-context';
import { MAX_UPLOAD_BYTES, saveUploadedImageBuffer } from '@/lib/uploads';

export async function POST(req: NextRequest) {
  return withAccount(req, async () => {
    try {
      const contentType = req.headers.get('content-type') || '';

      if (contentType.includes('multipart/form-data')) {
        const formData = await req.formData();
        const file = formData.get('file');
        if (!file || !(file instanceof Blob)) {
          return NextResponse.json({ error: 'Adjunta una imagen válida.' }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return NextResponse.json({ error: 'La imagen supera el límite de 10 MB.' }, { status: 400 });
        }
        const buf = Buffer.from(await file.arrayBuffer());
        const saved = saveUploadedImageBuffer(buf, file.type);
        return NextResponse.json(saved, { status: 201 });
      }

      const body = await req.json().catch(() => null);
      const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl.trim() : '';
      const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp|gif));base64,([A-Za-z0-9+/=]+)$/i);
      if (!match) {
        return NextResponse.json(
          { error: 'Envía una imagen mediante multipart/form-data o dataUrl válido.' },
          { status: 400 }
        );
      }
      const mime = match[1];
      const buf = Buffer.from(match[2], 'base64');
      const saved = saveUploadedImageBuffer(buf, mime);
      return NextResponse.json(saved, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : 'No se pudo guardar la imagen' },
        { status: 400 }
      );
    }
  });
}
