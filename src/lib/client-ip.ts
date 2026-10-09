/** Cabeceras de la capa de ingreso, compartidas por Edge y Node. */
export function clientIpFromHeaders(headers: Headers): string | null {
  // Render recibe el trafico publico a traves de Cloudflare, que reemplaza
  // CF-Connecting-IP. No confiar en el primer XFF suministrado por el cliente.
  const edge = process.env.RENDER === 'true' ? headers.get('cf-connecting-ip') : null;
  const forwarded = headers.get('x-forwarded-for')?.split(',').at(-1)?.trim();
  const candidate = edge ?? forwarded;
  return candidate && candidate.length <= 45 && /^[0-9a-fA-F:.]+$/.test(candidate) ? candidate : null;
}
