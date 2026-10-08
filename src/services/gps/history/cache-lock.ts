import 'server-only';
import { randomUUID } from 'node:crypto';
import { open, readFile, stat, unlink } from 'node:fs/promises';

/** Exclusión entre grabador y servidor web, sin dejar un bloqueo al morir el proceso. */
export async function acquireGpsCacheLock(filename: string): Promise<() => Promise<void>> {
  const lockfile = `${filename}.lock`;
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  const deadline = performance.now() + 5000;
  while (true) {
    try {
      const handle = await open(lockfile, 'wx', 0o600);
      try { await handle.writeFile(owner); }
      catch (error) { await handle.close(); await unlink(lockfile).catch(() => {}); throw error; }
      await handle.close();
      return async () => {
        if (await readFile(lockfile, 'utf8').catch(() => null) === owner) await unlink(lockfile).catch(() => {});
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    try {
      const content = await readFile(lockfile, 'utf8');
      let stale = false;
      try {
        const { pid } = JSON.parse(content) as { pid?: number };
        if (Number.isInteger(pid) && pid! > 0) {
          try { process.kill(pid!, 0); }
          catch (error) { stale = (error as NodeJS.ErrnoException).code === 'ESRCH'; }
        } else stale = Date.now() - (await stat(lockfile)).mtimeMs > 30_000;
      } catch { stale = Date.now() - (await stat(lockfile)).mtimeMs > 30_000; }
      if (stale && await readFile(lockfile, 'utf8').catch(() => null) === content) {
        await unlink(lockfile).catch(() => {});
        continue;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (performance.now() >= deadline) throw new Error('El archivo GPS sigue ocupado. Se reintentará en la próxima lectura.');
    await new Promise<void>((done) => setTimeout(done, 20));
  }
}
