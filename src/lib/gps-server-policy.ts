/** Solo infraestructura puede autorizar un endpoint que recibira credenciales. */
export function isAuthorizedGpsServer(candidate: string, configured: string | undefined): boolean {
  if (!configured) return false;
  try {
    const target = new URL(candidate); const allowed = new URL(configured);
    return !target.username && !target.password &&
      (process.env.NODE_ENV !== 'production' || target.protocol === 'https:') &&
      target.href.replace(/\/+$/, '') === allowed.href.replace(/\/+$/, '');
  } catch { return false; }
}
