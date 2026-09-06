import 'server-only';

import { getSupabaseClient, isSupabaseConfigured } from '@/lib/supabase/server-client';

/**
 * Registro de acciones administrativas (tabla `auditoria`).
 *
 * No condiciona ningun flujo: si el registro falla, la accion que lo motivo
 * ya se aplico y no tiene sentido revertirla por un problema de auditoria.
 * Se limita a dejar constancia, en un mejor esfuerzo.
 */

export interface AuditEntry {
  userId: string | null;
  action: string;
  entity?: string;
  entityId?: string;
  detail?: Record<string, unknown>;
  ip?: string | null;
}

export async function logAction(entry: AuditEntry): Promise<void> {
  if (!isSupabaseConfigured()) return;

  try {
    const { error } = await getSupabaseClient().from('auditoria').insert({
      usuario_id: entry.userId,
      accion: entry.action,
      entidad: entry.entity ?? null,
      entidad_id: entry.entityId ?? null,
      detalle: entry.detail ?? null,
      ip: entry.ip ?? null,
    });
    if (error) console.error('[audit] no fue posible registrar la accion:', error.message);
  } catch (error) {
    console.error('[audit] no fue posible registrar la accion:', error);
  }
}
