import { DEFAULT_OPERATIONAL_SETTINGS, type OperationalSettings } from '@/config/operational';
import type { Client, ClientActivityStatus, ClientSnapshot, IsoDateTime } from '@/types/core';

export interface ClientActivityInput {
  lastPurchaseAt: IsoDateTime | null;
  lastVisitAt: IsoDateTime | null;
  thresholds: OperationalSettings['clients'];
  /** Momento de referencia. Inyectable para que el calculo sea determinista. */
  now?: Date;
}

export interface ClientActivityResult {
  status: ClientActivityStatus;
  daysSincePurchase: number | null;
  daysSinceVisit: number | null;
  /** Dias efectivamente usados para clasificar. */
  effectiveDays: number | null;
  /** Que senal decidio la clasificacion. */
  basis: 'purchase' | 'visit' | 'none';
}

const MS_PER_DAY = 86_400_000;

function fullDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function daysSince(iso: IsoDateTime | null, now: Date): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, fullDaysBetween(date, now));
}

/**
 * Unico punto donde se decide el estado comercial de un cliente.
 *
 * Ningun componente debe derivar el color verde/amarillo/rojo por su cuenta:
 * cuando Fenice ajuste los umbrales, solo cambia la configuracion.
 *
 * Semantica de los umbrales (inclusivos por el limite inferior):
 *   dias <= activeMaxDays                      -> active   (verde)
 *   activeMaxDays < dias <= warningMaxDays     -> warning  (amarillo)
 *   dias > warningMaxDays                      -> dormant  (rojo)
 *
 * Un cliente sin ninguna compra registrada se considera `dormant`: es un
 * cliente que nunca compro, y operacionalmente merece la misma atencion que
 * uno que dejo de comprar.
 */
export function calculateClientActivityStatus(
  input: ClientActivityInput,
): ClientActivityResult {
  const now = input.now ?? new Date();
  const { thresholds } = input;

  const daysSincePurchase = daysSince(input.lastPurchaseAt, now);
  const daysSinceVisit = daysSince(input.lastVisitAt, now);

  // La compra es la senal primaria. La visita solo participa si esta activada
  // y es mas reciente: una visita comercial reciente atenua el riesgo.
  let effectiveDays = daysSincePurchase;
  let basis: ClientActivityResult['basis'] = daysSincePurchase === null ? 'none' : 'purchase';

  if (thresholds.useVisitAsActivitySignal && daysSinceVisit !== null) {
    if (effectiveDays === null || daysSinceVisit < effectiveDays) {
      effectiveDays = daysSinceVisit;
      basis = 'visit';
    }
  }

  if (effectiveDays === null) {
    return { status: 'dormant', daysSincePurchase, daysSinceVisit, effectiveDays: null, basis: 'none' };
  }

  const status: ClientActivityStatus =
    effectiveDays <= thresholds.activeMaxDays
      ? 'active'
      : effectiveDays <= thresholds.warningMaxDays
        ? 'warning'
        : 'dormant';

  return { status, daysSincePurchase, daysSinceVisit, effectiveDays, basis };
}

/** Sub-clasificacion usada por la seccion de clientes dormidos. */
export type DormancyTier = 'en_riesgo' | 'dormido' | 'critico';

/**
 * Escalona el riesgo comercial. `en_riesgo` corresponde al tramo amarillo;
 * a partir del umbral rojo se separa entre dormido y critico usando el doble
 * del umbral de observacion como punto de corte.
 */
export function classifyDormancy(
  effectiveDays: number | null,
  thresholds: OperationalSettings['clients'],
): DormancyTier {
  if (effectiveDays === null) return 'critico';
  if (effectiveDays <= thresholds.warningMaxDays) return 'en_riesgo';
  if (effectiveDays <= thresholds.warningMaxDays * 2) return 'dormido';
  return 'critico';
}

export const DORMANCY_TIER_LABEL: Record<DormancyTier, string> = {
  en_riesgo: 'En riesgo',
  dormido: 'Dormido',
  critico: 'Critico',
};

export const CLIENT_STATUS_LABEL: Record<ClientActivityStatus, string> = {
  active: 'Activo',
  warning: 'En observacion',
  dormant: 'Dormido',
};

/** Colores canonicos del estado comercial. Fuente unica para UI y mapa. */
export const CLIENT_STATUS_COLOR: Record<ClientActivityStatus, string> = {
  active: '#15803d',
  warning: '#b45309',
  dormant: '#dc2626',
};

export interface BuildClientSnapshotInput {
  client: Client;
  settings?: OperationalSettings;
  hasPendingOrder?: boolean;
  visitedToday?: boolean;
  now?: Date;
}

function isSameLocalDay(iso: IsoDateTime | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Compone la proyeccion de cliente que consume la UI. */
export function buildClientSnapshot(input: BuildClientSnapshotInput): ClientSnapshot {
  const settings = input.settings ?? DEFAULT_OPERATIONAL_SETTINGS;
  const now = input.now ?? new Date();

  const activity = calculateClientActivityStatus({
    lastPurchaseAt: input.client.lastPurchaseAt,
    lastVisitAt: input.client.lastVisitAt,
    thresholds: settings.clients,
    now,
  });

  const primaryLocation =
    input.client.locations.find((l) => l.isPrimary) ?? input.client.locations[0] ?? null;

  return {
    client: input.client,
    activityStatus: activity.status,
    daysSincePurchase: activity.daysSincePurchase,
    daysSinceVisit: activity.daysSinceVisit,
    primaryLocation,
    hasPendingOrder: input.hasPendingOrder ?? false,
    visitedToday: input.visitedToday ?? isSameLocalDay(input.client.lastVisitAt, now),
  };
}
