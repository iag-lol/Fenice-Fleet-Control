/** Lectura acotada incluso sin Content-Length o con transferencia fragmentada. */
export async function readJsonBody(request: Request, maxBytes = 64 * 1024): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const bytes = await readBoundedBody(request, maxBytes);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

export async function readBoundedBody(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      parts.push(value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.length; }
    return data;
  } catch { return null; }
  finally { reader.releaseLock(); }
}
