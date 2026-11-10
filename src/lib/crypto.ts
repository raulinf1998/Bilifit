import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDbPath } from '@/lib/db';

function getEncryptionKey(): Buffer {
  const envSecret = process.env.BILIFIT_SECRET?.trim();
  if (envSecret) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  const dbDir = path.dirname(getDbPath());
  const keyFile = path.join(dbDir, '.bilifit-secret');
  try {
    if (fs.existsSync(keyFile)) {
      const hex = fs.readFileSync(keyFile, 'utf8').trim();
      if (/^[0-9a-f]{64}$/i.test(hex)) {
        return Buffer.from(hex, 'hex');
      }
    }
    fs.mkdirSync(dbDir, { recursive: true });
    const raw = crypto.randomBytes(32);
    fs.writeFileSync(keyFile, raw.toString('hex'), { mode: 0o600 });
    return raw;
  } catch {
    return crypto.createHash('sha256').update(`bilifit-local:${getDbPath()}`).digest();
  }
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(payload: string): string | null {
  try {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== 'v1') return null;
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const data = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
