import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { acquireGpsCacheLock } from './cache-lock';
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const filename = async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fenice-gps-lock-')); directories.push(directory);
  return join(directory, 'cache.json');
};
it('serializa escritores independientes y elimina sólo su propio bloqueo privado', async () => {
  const file = await filename();
  const release = await acquireGpsCacheLock(file);
  expect((await stat(`${file}.lock`)).mode & 0o777).toBe(0o600);
  const second = acquireGpsCacheLock(file);
  await release();
  const releaseSecond = await second;
  expect(JSON.parse(await readFile(`${file}.lock`, 'utf8')).pid).toBe(process.pid);
  await release(); // el dueño anterior no puede liberar el bloqueo nuevo
  expect(await stat(`${file}.lock`)).toBeDefined();
  await releaseSecond();
  await expect(stat(`${file}.lock`)).rejects.toMatchObject({ code: 'ENOENT' });
});
it('recupera un bloqueo abandonado por un proceso que terminó', async () => {
  const file = await filename();
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
  const pid = child.pid;
  await new Promise<void>((done, reject) => { child.once('exit', () => done()); child.once('error', reject); });
  expect(pid).toBeGreaterThan(0);
  await writeFile(`${file}.lock`, JSON.stringify({ pid, token: 'orphan' }), { mode: 0o600 });
  const release = await acquireGpsCacheLock(file);
  expect(JSON.parse(await readFile(`${file}.lock`, 'utf8')).token).not.toBe('orphan');
  await release();
});
