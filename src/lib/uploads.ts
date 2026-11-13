import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function getUploadsDir(): string {
  const explicit = process.env.BILIFIT_UPLOADS_DIR;
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.join(/*turbopackIgnore: true*/ process.cwd(), explicit);
  }
  const dbPath = process.env.BILIFIT_DB_PATH
    ? path.isAbsolute(process.env.BILIFIT_DB_PATH)
      ? process.env.BILIFIT_DB_PATH
      : path.join(/*turbopackIgnore: true*/ process.cwd(), process.env.BILIFIT_DB_PATH)
    : path.join(/*turbopackIgnore: true*/ process.cwd(), 'data', 'bilifit.db');
  return path.join(path.dirname(dbPath), 'uploads');
}

export function detectImageExtension(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length < 8) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { ext: 'png', mime: 'image/png' };
  }
  // GIF: GIF87a / GIF89a
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
    return { ext: 'gif', mime: 'image/gif' };
  }
  // WEBP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export function saveUploadedImageBuffer(
  buf: Buffer,
  _fallbackMime?: string | null
): { filename: string; url: string; mime: string } {
  if (buf.length === 0) {
    throw new Error('La imagen está vacía.');
  }
  if (buf.length > MAX_UPLOAD_BYTES) {
    throw new Error('La imagen supera el límite de 10 MB.');
  }
  const detected = detectImageExtension(buf);
  if (!detected) {
    throw new Error('Formato de imagen no compatible. Usa JPG, PNG, WebP o GIF.');
  }

  const dir = getUploadsDir();
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(/*turbopackIgnore: true*/ dir, { recursive: true });
  }

  const filename = `${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 10)}.${detected.ext}`;
  const fullPath = path.join(/*turbopackIgnore: true*/ dir, filename);
  fs.writeFileSync(/*turbopackIgnore: true*/ fullPath, buf);

  return {
    filename,
    url: `/api/uploads/${filename}`,
    mime: detected.mime,
  };
}

export function resolveUploadFilePath(filename: string): { filePath: string; mime: string } | null {
  const clean = path.basename(filename);
  if (clean !== filename || !/^[a-zA-Z0-9_-]+\.(jpg|jpeg|png|webp|gif)$/i.test(clean)) {
    return null;
  }
  const ext = path.extname(clean).slice(1).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return null;
  const fullPath = path.join(getUploadsDir(), clean);
  if (!fs.existsSync(fullPath)) return null;
  return { filePath: fullPath, mime };
}

export function sanitizeImageUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2_000_000) return null;

  if (/^\/(exercises|api\/uploads|maps)\/[a-zA-Z0-9._/-]+$/.test(trimmed) && !trimmed.includes('..')) {
    return trimmed;
  }
  if (/^https?:\/\/[^\s"'<>]+$/i.test(trimmed)) {
    return trimmed;
  }
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  return null;
}

export function sanitizeImageList(raw: unknown, maxItems = 12): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const clean = sanitizeImageUrl(item);
    if (clean && !seen.has(clean)) {
      seen.add(clean);
      out.push(clean);
      if (out.length >= maxItems) break;
    }
  }
  return out;
}
