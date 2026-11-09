import zlib from 'node:zlib';
import JSZip from 'jszip';
import { parseFitBuffer } from '@/lib/parsers/fit';
import { parseGpxString, type ParsedActivityData } from '@/lib/parsers/gpx';
import { parseTcxString } from '@/lib/parsers/tcx';

export type { ParsedActivityData };

export async function parseUploadedActivityFile(
  fileName: string,
  buffer: Buffer
): Promise<{ activities: ParsedActivityData[]; errors: string[] }> {
  const lower = fileName.toLowerCase();
  const activities: ParsedActivityData[] = [];
  const errors: string[] = [];

  if (lower.endsWith('.zip')) {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    for (const entry of entries) {
      const name = entry.name;
      const entryLower = name.toLowerCase();
      if (
        !entryLower.endsWith('.gpx') &&
        !entryLower.endsWith('.tcx') &&
        !entryLower.endsWith('.fit') &&
        !entryLower.endsWith('.gpx.gz') &&
        !entryLower.endsWith('.tcx.gz') &&
        !entryLower.endsWith('.fit.gz')
      ) {
        continue;
      }
      try {
        const raw = await entry.async('nodebuffer');
        const sub = await parseUploadedActivityFile(name.split('/').pop() ?? name, raw);
        activities.push(...sub.activities);
        errors.push(...sub.errors);
      } catch (err) {
        errors.push(`${name}: ${err instanceof Error ? err.message : 'Error al procesar archivo'}`);
      }
    }
    if (activities.length === 0 && errors.length === 0) {
      errors.push('El ZIP no contiene archivos .fit, .gpx o .tcx.');
    }
    return { activities, errors };
  }

  let workingBuffer = buffer;
  let effectiveName = fileName;
  if (lower.endsWith('.gz')) {
    workingBuffer = zlib.gunzipSync(buffer);
    effectiveName = fileName.slice(0, -3);
  }

  const effLower = effectiveName.toLowerCase();
  try {
    if (effLower.endsWith('.gpx') || effLower.endsWith('.xml')) {
      activities.push(parseGpxString(workingBuffer.toString('utf8'), effectiveName));
    } else if (effLower.endsWith('.tcx')) {
      activities.push(parseTcxString(workingBuffer.toString('utf8'), effectiveName));
    } else if (effLower.endsWith('.fit')) {
      activities.push(await parseFitBuffer(workingBuffer, effectiveName));
    } else {
      errors.push(`Formato no soportado para ${fileName}. Usa .fit, .gpx, .tcx o .zip.`);
    }
  } catch (err) {
    errors.push(`${fileName}: ${err instanceof Error ? err.message : 'Error al parsear archivo'}`);
  }

  return { activities, errors };
}
