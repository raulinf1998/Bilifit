import zlib from 'node:zlib';
import JSZip from 'jszip';
import { parseFitBuffer } from '@/lib/parsers/fit';
import { parseGpxString, type ParsedActivityData } from '@/lib/parsers/gpx';
import {
  applyHealthSyncMetadata,
  groupHealthSyncFiles,
  isHiTrackBuffer,
  isHuaweiMotionPathJson,
  parseHealthSyncCsv,
  parseHuaweiMotionPathJson,
  parseHiTrackText,
} from '@/lib/parsers/huawei';
import { parseTcxString } from '@/lib/parsers/tcx';

export type { ParsedActivityData };

export function sniffActivityFormat(
  buffer: Buffer
): '.fit' | '.gpx' | '.tcx' | '.zip' | '.gz' | '.json' | '.hitrack' | null {
  if (!buffer || buffer.length === 0) return null;
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return '.zip';
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return '.gz';
  }
  if (buffer.length >= 12 && buffer.subarray(8, 12).toString('ascii') === '.FIT') {
    return '.fit';
  }
  // Quitar BOM UTF-8 (\xEF\xBB\xBF) antes de detectar texto GPX/TCX/Huawei
  const offset = buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  const head = buffer.subarray(offset, Math.min(buffer.length, offset + 2048)).toString('utf8').trimStart();
  if (head.includes('<gpx')) return '.gpx';
  if (head.includes('<TrainingCenterDatabase')) return '.tcx';
  if (isHuaweiMotionPathJson(head)) return '.json';
  if (isHiTrackBuffer(head)) return '.hitrack';
  return null;
}

export async function parseUploadedActivityFile(
  fileName: string,
  buffer: Buffer
): Promise<{ activities: ParsedActivityData[]; errors: string[] }> {
  const lower = fileName.toLowerCase();
  const baseName = fileName.split(/[\\/]/).pop() ?? fileName;
  const sniffed = sniffActivityFormat(buffer);
  const activities: ParsedActivityData[] = [];
  const errors: string[] = [];

  if (lower.endsWith('.zip') || sniffed === '.zip') {
    const zip = await JSZip.loadAsync(buffer);
    const entries = Object.values(zip.files).filter((entry) => !entry.dir);
    const relevant: Array<{ fileName: string; entry: JSZip.JSZipObject }> = [];

    for (const entry of entries) {
      const name = entry.name.split('/').pop() ?? entry.name;
      const entryLower = name.toLowerCase();
      const isHiTrackName = /^hitrack_/i.test(name) && !name.includes('.');
      const isHuaweiMotionJson =
        entryLower.endsWith('.json') &&
        (entry.name.toLowerCase().includes('motion path') || entryLower.includes('motion') || entryLower.includes('huawei'));
      if (
        entryLower.endsWith('.gpx') ||
        entryLower.endsWith('.tcx') ||
        entryLower.endsWith('.fit') ||
        entryLower.endsWith('.dms') ||
        entryLower.endsWith('.gpx.gz') ||
        entryLower.endsWith('.tcx.gz') ||
        entryLower.endsWith('.fit.gz') ||
        entryLower.endsWith('.csv') ||
        isHuaweiMotionJson ||
        isHiTrackName
      ) {
        relevant.push({ fileName: name, entry });
      }
    }

    const grouped = groupHealthSyncFiles(relevant.map((r) => ({ fileName: r.fileName, item: r })));
    for (const grp of grouped) {
      try {
        const primaryRaw = await grp.primary.item.entry.async('nodebuffer');
        if (grp.primary.fileName.toLowerCase().endsWith('.csv')) continue;
        const sub = await parseUploadedActivityFile(grp.primary.fileName, primaryRaw);

        if (grp.csvMetaItem && sub.activities.length > 0) {
          try {
            const csvBuf = await grp.csvMetaItem.item.entry.async('nodebuffer');
            const meta = parseHealthSyncCsv(csvBuf.toString('utf8'));
            sub.activities = sub.activities.map((a) => applyHealthSyncMetadata(a, meta));
          } catch {
            // Si el CSV opcional falla, continuar con la actividad principal
          }
        }

        if (grp.fallbackTrackItems?.length && sub.activities.length > 0 && (sub.activities[0].laps?.length ?? 0) <= 1) {
          for (const sib of grp.fallbackTrackItems) {
            if (!sib.fileName.toLowerCase().endsWith('.tcx')) continue;
            try {
              const sibRaw = await sib.item.entry.async('nodebuffer');
              const sibParsed = await parseUploadedActivityFile(sib.fileName, sibRaw);
              const sibLaps = sibParsed.activities[0]?.laps ?? [];
              if (sibLaps.length > (sub.activities[0].laps?.length ?? 0)) {
                sub.activities[0].laps = sibLaps;
                break;
              }
            } catch {
              // Ignorar fallback secundario
            }
          }
        }

        activities.push(...sub.activities);
        errors.push(...sub.errors);
      } catch (err) {
        errors.push(`${grp.primary.fileName}: ${err instanceof Error ? err.message : 'Error al procesar archivo'}`);
      }
    }

    if (activities.length === 0 && errors.length === 0) {
      errors.push('El ZIP no contiene archivos .fit, .gpx, .tcx ni datos de movimiento de Huawei Health.');
    }
    return { activities, errors };
  }

  let workingBuffer = buffer;
  let effectiveName = baseName;
  if (lower.endsWith('.gz') || sniffed === '.gz') {
    workingBuffer = zlib.gunzipSync(buffer);
    effectiveName = lower.endsWith('.gz') ? baseName.slice(0, -3) : baseName;
  }

  const effLower = effectiveName.toLowerCase();
  const effectiveSniffed = sniffActivityFormat(workingBuffer);
  try {
    if (effLower.endsWith('.gpx') || effLower.endsWith('.xml') || effectiveSniffed === '.gpx') {
      activities.push(parseGpxString(workingBuffer.toString('utf8'), effectiveName));
    } else if (effLower.endsWith('.tcx') || effectiveSniffed === '.tcx') {
      activities.push(parseTcxString(workingBuffer.toString('utf8'), effectiveName));
    } else if (effLower.endsWith('.fit') || effLower.endsWith('.dms') || effectiveSniffed === '.fit') {
      activities.push(await parseFitBuffer(workingBuffer, effectiveName.replace(/\.dms$/i, '.fit')));
    } else if (effLower.endsWith('.json') || effectiveSniffed === '.json') {
      const text = workingBuffer.toString('utf8');
      if (isHuaweiMotionPathJson(text)) {
        const list = parseHuaweiMotionPathJson(text, effectiveName);
        if (list.length === 0) {
          errors.push(`${effectiveName}: El JSON de Huawei no contiene rutas o sesiones importables.`);
        } else {
          activities.push(...list);
        }
      } else {
        errors.push(`El archivo JSON ${fileName} no tiene estructura de Motion Path de Huawei Health.`);
      }
    } else if (effectiveSniffed === '.hitrack' || /^hitrack_/i.test(effectiveName)) {
      activities.push(parseHiTrackText(workingBuffer.toString('utf8'), { fileName: effectiveName }));
    } else {
      errors.push(`Formato no soportado para ${fileName}. Usa .fit, .gpx, .tcx, .zip o exportación Huawei.`);
    }
  } catch (err) {
    errors.push(`${fileName}: ${err instanceof Error ? err.message : 'Error al parsear archivo'}`);
  }

  return { activities, errors };
}

/**
 * Procesa lotes de múltiples archivos subidos simultáneamente (p. ej. carpeta Health Sync),
 * agrupando automáticamente formatos duplicados (.fit > .tcx > .gpx) y aplicando títulos/pasos del .csv hermano.
 */
export async function parseUploadedActivityBatch(
  files: Array<{ fileName: string; buffer: Buffer }>
): Promise<{ activities: ParsedActivityData[]; errors: string[] }> {
  const activities: ParsedActivityData[] = [];
  const errors: string[] = [];

  const grouped = groupHealthSyncFiles(files.map((f) => ({ fileName: f.fileName, item: f })));
  for (const grp of grouped) {
    if (grp.primary.fileName.toLowerCase().endsWith('.csv')) continue;
    const sub = await parseUploadedActivityFile(grp.primary.fileName, grp.primary.item.buffer);
    if (grp.csvMetaItem && sub.activities.length > 0) {
      const meta = parseHealthSyncCsv(grp.csvMetaItem.item.buffer.toString('utf8'));
      sub.activities = sub.activities.map((a) => applyHealthSyncMetadata(a, meta));
    }
    if (grp.fallbackTrackItems?.length && sub.activities.length > 0 && (sub.activities[0].laps?.length ?? 0) <= 1) {
      for (const sib of grp.fallbackTrackItems) {
        if (!sib.fileName.toLowerCase().endsWith('.tcx')) continue;
        try {
          const sibParsed = await parseUploadedActivityFile(sib.fileName, sib.item.buffer);
          const sibLaps = sibParsed.activities[0]?.laps ?? [];
          if (sibLaps.length > (sub.activities[0].laps?.length ?? 0)) {
            sub.activities[0].laps = sibLaps;
            break;
          }
        } catch {
          // Ignorar fallback secundario
        }
      }
    }
    activities.push(...sub.activities);
    errors.push(...sub.errors);
  }

  return { activities, errors };
}
