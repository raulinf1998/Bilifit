'use client';

async function compressImageIfPossible(file: File): Promise<File | Blob> {
  // No recomprimir GIF animados ni archivos muy pequeños ya optimizados
  if (file.type === 'image/gif' || file.size <= 350 * 1024) {
    return file;
  }
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return file;
  }

  try {
    let sourceWidth = 0;
    let sourceHeight = 0;
    let drawSource: CanvasImageSource | null = null;
    let closeBitmap: (() => void) | null = null;

    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      sourceWidth = bitmap.width;
      sourceHeight = bitmap.height;
      drawSource = bitmap;
      closeBitmap = () => bitmap.close();
    } else {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Error leyendo imagen'));
        reader.readAsDataURL(file);
      });
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('No se pudo decodificar imagen'));
        el.src = dataUrl;
      });
      sourceWidth = img.naturalWidth;
      sourceHeight = img.naturalHeight;
      drawSource = img;
    }

    if (!drawSource || sourceWidth <= 0 || sourceHeight <= 0) {
      closeBitmap?.();
      return file;
    }

    const MAX_DIM = 1400;
    const scale = Math.min(1, MAX_DIM / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      closeBitmap?.();
      return file;
    }

    ctx.drawImage(drawSource, 0, 0, width, height);
    closeBitmap?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.85)
    );
    if (!blob || blob.size >= file.size) {
      return file;
    }
    return blob;
  } catch {
    return file;
  }
}

export async function uploadExerciseOrWorkoutImage(file: File): Promise<string> {
  const payload = await compressImageIfPossible(file);
  const formData = new FormData();
  const safeName = file.name ? file.name.replace(/\.[^.]+$/, '.jpg') : 'foto.jpg';
  formData.append('file', payload, payload === file ? file.name : safeName);

  const res = await fetch('/api/uploads', {
    method: 'POST',
    body: formData,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.url) {
    throw new Error(data?.error || 'No se pudo subir la imagen.');
  }
  return String(data.url);
}
