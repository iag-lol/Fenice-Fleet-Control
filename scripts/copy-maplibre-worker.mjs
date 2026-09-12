import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Next's main bundle does not guarantee a stable URL for MapLibre's module
// worker. Serve the matching worker and its shared module from this install.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'maplibre-gl', 'dist');
const target = join(root, 'public', 'maplibre');
await mkdir(target, { recursive: true });
for (const name of ['maplibre-gl-worker', 'maplibre-gl-shared']) {
  const original = await readFile(join(source, `${name}.mjs`), 'utf8');
  const output = original
    .replaceAll('"./maplibre-gl-shared.mjs"', '"./maplibre-gl-shared.js"')
    .replace(/\n?\/\/# sourceMappingURL=.*$/m, '');
  await writeFile(join(target, `${name}.js`), output);
}
