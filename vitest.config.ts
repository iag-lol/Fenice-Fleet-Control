import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // `server-only` lanza al importarse fuera de un contexto de servidor de
    // Next; en las pruebas se sustituye por un modulo vacio.
    alias: { 'server-only': fileURLToPath(new URL('./tests/server-only-stub.ts', import.meta.url)) },
  },
});
