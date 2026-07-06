export type CompressedImage = {
  name: string;
  mime_type?: string | null;
  data_url: string;
};

export const MAX_STUDENT_IMAGE_BYTES = 2 * 1024 * 1024;

export function estimateDataUrlBytes(dataUrl: string): number {
  const raw = dataUrl.includes(",") ? dataUrl.split(",", 2)[1] : dataUrl;
  const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((raw.length * 3) / 4) - padding);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to read image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("failed to encode image"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("failed to decode image"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

export async function compressImageFileToDataUrl(
  file: File,
  maxBytes: number = MAX_STUDENT_IMAGE_BYTES,
): Promise<CompressedImage> {
  const original = await readFileAsDataUrl(file);
  if (estimateDataUrlBytes(original) <= maxBytes) {
    return { name: file.name, mime_type: file.type, data_url: original };
  }
  if (typeof document === "undefined" || typeof Image === "undefined") {
    return { name: file.name, mime_type: file.type, data_url: original };
  }

  const image = await loadImage(original);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) {
    return { name: file.name, mime_type: file.type, data_url: original };
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { name: file.name, mime_type: file.type, data_url: original };
  }

  let best: { dataUrl: string; bytes: number } | null = null;
  const scales = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.24];
  const qualities = [0.86, 0.76, 0.66, 0.56, 0.46, 0.36];
  for (const scale of scales) {
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of qualities) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!blob) continue;
      const dataUrl = await blobToDataUrl(blob);
      const bytes = estimateDataUrlBytes(dataUrl);
      if (!best || bytes < best.bytes) {
        best = { dataUrl, bytes };
      }
      if (bytes <= maxBytes) {
        return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mime_type: "image/jpeg", data_url: dataUrl };
      }
    }
  }

  if (best) {
    return { name: file.name.replace(/\.[^.]+$/, ".jpg"), mime_type: "image/jpeg", data_url: best.dataUrl };
  }
  return { name: file.name, mime_type: file.type, data_url: original };
}
