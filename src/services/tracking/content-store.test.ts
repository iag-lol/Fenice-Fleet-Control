import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const state = vi.hoisted(() => ({
  directory: '',
  configured: false,
  download: vi.fn(),
  upload: vi.fn(),
  getBucket: vi.fn(),
  createBucket: vi.fn(),
}));
vi.mock('@/config/env', () => ({
  getServerEnv: () => ({ TRACKING_CONTENT_DIR: state.directory }),
}));
vi.mock('@/lib/supabase/server-client', () => ({
  isSupabaseConfigured: () => state.configured,
  getSupabaseClient: () => ({
    storage: {
      from: () => ({ download: state.download, upload: state.upload }),
      getBucket: state.getBucket,
      createBucket: state.createBucket,
    },
  }),
}));
import {
  getTrackingContent,
  getTrackingImage,
  saveTrackingContent,
  saveTrackingImage,
} from './content-store';
import {
  DEFAULT_TRACKING_CONTENT,
  EXAMPLE_TRACKING_SLIDES,
} from '@/config/tracking-content';
const content = {
  ...DEFAULT_TRACKING_CONTENT,
  enabled: true,
  slides: EXAMPLE_TRACKING_SLIDES,
};
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
beforeEach(async () => {
  state.directory = await mkdtemp(path.join(os.tmpdir(), 'fenice-tracking-'));
  state.configured = false;
  vi.stubEnv('VERCEL', '');
  vi.clearAllMocks();
  state.getBucket.mockResolvedValue({ data: {}, error: null });
  state.upload.mockResolvedValue({ error: null });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(state.directory, { recursive: true, force: true });
});
describe('almacenamiento de publicidad', () => {
  it('conserva configuración e imágenes en disco y no requiere memoria de proceso', async () => {
    expect(await getTrackingContent()).toEqual(DEFAULT_TRACKING_CONTENT);
    await saveTrackingContent(content);
    expect(await getTrackingContent()).toEqual(content);
    const url = await saveTrackingImage(png);
    expect(
      Array.from((await getTrackingImage(url.split('/').at(-1)!))!),
    ).toEqual(Array.from(png));
    expect(await getTrackingImage('../../content.json')).toBeNull();
  });
  it('rechaza corrupción y no sobrescribe al recibir una configuración inválida', async () => {
    await saveTrackingContent(content);
    await expect(saveTrackingContent({ enabled: 'bad' })).rejects.toThrow();
    expect(await getTrackingContent()).toEqual(content);
    await writeFile(path.join(state.directory, 'content.json'), '{invalid');
    await expect(getTrackingContent()).rejects.toThrow();
  });
  it('no anuncia persistencia en Vercel cuando falta almacenamiento durable', async () => {
    vi.stubEnv('VERCEL', '1');
    await expect(saveTrackingContent(content)).rejects.toThrow('Supabase');
    await expect(saveTrackingImage(png)).rejects.toThrow('Supabase');
  });
  it('usa bucket privado y confirma la escritura a Supabase antes de informar éxito', async () => {
    state.configured = true;
    state.getBucket.mockResolvedValueOnce({
      error: { status: 404, message: 'Bucket not found' },
    });
    state.createBucket.mockResolvedValue({ error: null });
    await saveTrackingContent(content);
    expect(state.createBucket).toHaveBeenCalledWith(
      'fenice-tracking-content',
      expect.objectContaining({ public: false }),
    );
    expect(state.upload).toHaveBeenCalledWith(
      'content.json',
      expect.any(Buffer),
      expect.objectContaining({
        contentType: 'application/json',
        upsert: true,
      }),
    );
    state.download.mockResolvedValue({
      data: new Blob([JSON.stringify(content)]),
      error: null,
    });
    expect(await getTrackingContent()).toEqual(content);
    state.upload.mockResolvedValue({ error: new Error('network failure') });
    await expect(saveTrackingContent(content)).rejects.toThrow(
      'network failure',
    );
  });
  it('no confunde un fallo de permisos con ausencia de campañas', async () => {
    state.configured = true;
    state.download.mockResolvedValue({
      error: { status: 403, message: 'Forbidden' },
    });
    await expect(getTrackingContent()).rejects.toMatchObject({ status: 403 });
    state.download.mockResolvedValue({
      error: { status: 404, message: 'Not found' },
    });
    expect(await getTrackingContent()).toEqual(DEFAULT_TRACKING_CONTENT);
  });
});
