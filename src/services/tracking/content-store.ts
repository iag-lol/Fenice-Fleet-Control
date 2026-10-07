import 'server-only';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getServerEnv } from '@/config/env';
import {
  DEFAULT_TRACKING_CONTENT,
  MAX_TRACKING_IMAGE_BYTES,
  TRACKING_IMAGE_ID,
  trackingContentSchema,
  trackingImageType,
  type TrackingContent,
} from '@/config/tracking-content';
import {
  getSupabaseClient,
  isSupabaseConfigured,
} from '@/lib/supabase/server-client';

// Bucket privado: el servidor publica únicamente configuración validada e imágenes.
// No necesita tablas ni políticas de escritura para visitantes del seguimiento.
const BUCKET = 'fenice-tracking-content';
const CONFIG_FILE = 'content.json';
const directory = () => path.resolve(getServerEnv().TRACKING_CONTENT_DIR);
const missing = (error: {
  status?: number | string;
  statusCode?: number | string;
  message?: string;
}) =>
  [404, '404'].includes(error.status ?? error.statusCode ?? 0) ||
  /not found|does not exist/i.test(error.message ?? '');

async function ensureBucket(): Promise<void> {
  const storage = getSupabaseClient().storage;
  const { error } = await storage.getBucket(BUCKET);
  if (!error) return;
  if (!missing(error)) throw error;
  const created = await storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: MAX_TRACKING_IMAGE_BYTES,
    allowedMimeTypes: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/json',
    ],
  });
  if (created.error) {
    // Otro proceso puede haberlo creado durante la consulta.
    const check = await storage.getBucket(BUCKET);
    if (check.error) throw created.error;
  }
}

function requireDurableDirectory(): void {
  if (process.env.VERCEL)
    throw new Error(
      'Conecta Supabase para conservar la publicidad en este despliegue.',
    );
}

export async function getTrackingContent(): Promise<TrackingContent> {
  let text: string;
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseClient()
      .storage.from(BUCKET)
      .download(CONFIG_FILE);
    if (error) {
      if (missing(error)) return DEFAULT_TRACKING_CONTENT;
      throw error;
    }
    text = await data.text();
  } else {
    try {
      text = await readFile(path.join(directory(), CONFIG_FILE), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return DEFAULT_TRACKING_CONTENT;
      throw error;
    }
  }
  return trackingContentSchema.parse(JSON.parse(text));
}

export async function saveTrackingContent(
  input: unknown,
): Promise<TrackingContent> {
  const content = trackingContentSchema.parse(input);
  const text = JSON.stringify(content);
  if (isSupabaseConfigured()) {
    await ensureBucket();
    const { error } = await getSupabaseClient()
      .storage.from(BUCKET)
      .upload(CONFIG_FILE, Buffer.from(text), {
        contentType: 'application/json',
        upsert: true,
        cacheControl: '0',
      });
    if (error) throw error;
  } else {
    requireDurableDirectory();
    await mkdir(directory(), { recursive: true });
    const temporary = path.join(
      directory(),
      `${CONFIG_FILE}.${randomUUID()}.tmp`,
    );
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, path.join(directory(), CONFIG_FILE));
  }
  return content;
}

export async function saveTrackingImage(bytes: Uint8Array): Promise<string> {
  const type = trackingImageType(bytes);
  if (!type || bytes.length > MAX_TRACKING_IMAGE_BYTES)
    throw new Error('Usa una imagen JPG, PNG o WebP de hasta 2 MB.');
  const imageId = `${randomUUID()}.${type.extension}`;
  if (isSupabaseConfigured()) {
    await ensureBucket();
    const { error } = await getSupabaseClient()
      .storage.from(BUCKET)
      .upload(imageId, bytes, {
        contentType: type.mime,
        upsert: false,
        cacheControl: '31536000',
      });
    if (error) throw error;
  } else {
    requireDurableDirectory();
    await mkdir(directory(), { recursive: true });
    await writeFile(path.join(directory(), imageId), bytes, {
      mode: 0o600,
      flag: 'wx',
    });
  }
  return `/api/seguimiento/imagenes/${imageId}`;
}

export async function getTrackingImage(
  imageId: string,
): Promise<Uint8Array | null> {
  if (!TRACKING_IMAGE_ID.test(imageId)) return null;
  if (isSupabaseConfigured()) {
    const { data, error } = await getSupabaseClient()
      .storage.from(BUCKET)
      .download(imageId);
    if (error) {
      if (missing(error)) return null;
      throw error;
    }
    return new Uint8Array(await data.arrayBuffer());
  }
  try {
    return await readFile(path.join(directory(), imageId));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
