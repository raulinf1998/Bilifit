import fs from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';
import { resolveUploadFilePath } from '@/lib/uploads';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ filename: string }> }
) {
  const { filename } = await context.params;
  const resolved = resolveUploadFilePath(filename);
  if (!resolved) {
    return NextResponse.json({ error: 'Imagen no encontrada' }, { status: 404 });
  }

  const data = fs.readFileSync(resolved.filePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Type': resolved.mime,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
