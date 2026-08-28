import { Badge, type BadgeProps } from '@/components/ui/badge';
import { CLIENT_STATUS_LABEL } from '@/lib/engines/client-activity';
import { CONNECTION_LABEL, VEHICLE_STATUS_LABEL } from '@/lib/engines/gps-health';
import type {
  AlertSeverity,
  DeliveryConfirmationSource,
  ClientActivityStatus,
  DeviceConnectionState,
  VehicleOperationalStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from '@/types/core';

/**
 * Traduccion de estado a distintivo visual.
 *
 * Fuente unica: ningun componente decide por su cuenta que color corresponde a
 * un estado. Cambiar la semantica de un estado se hace aqui y se propaga a
 * toda la plataforma.
 */

type Tone = NonNullable<BadgeProps['tone']>;

const CLIENT_TONE: Record<ClientActivityStatus, Tone> = {
  active: 'active',
  warning: 'warning',
  dormant: 'danger',
};

export function ClientStatusBadge({
  status,
  size,
}: {
  status: ClientActivityStatus;
  size?: BadgeProps['size'];
}) {
  return (
    <Badge tone={CLIENT_TONE[status]} size={size} dot>
      {CLIENT_STATUS_LABEL[status]}
    </Badge>
  );
}

const VEHICLE_TONE: Record<VehicleOperationalStatus, Tone> = {
  en_ruta: 'moving',
  detenido: 'warning',
  inactivo: 'neutral',
  offline: 'danger',
  mantenimiento: 'purple',
};

export function VehicleStatusBadge({
  status,
  size,
}: {
  status: VehicleOperationalStatus;
  size?: BadgeProps['size'];
}) {
  return (
    <Badge tone={VEHICLE_TONE[status]} size={size} dot>
      {VEHICLE_STATUS_LABEL[status]}
    </Badge>
  );
}

const CONNECTION_TONE: Record<DeviceConnectionState, Tone> = {
  online: 'active',
  stale: 'warning',
  lost: 'warning',
  offline: 'danger',
  unknown: 'neutral',
};

export function ConnectionBadge({ state }: { state: DeviceConnectionState }) {
  return (
    <Badge tone={CONNECTION_TONE[state]} dot>
      {CONNECTION_LABEL[state]}
    </Badge>
  );
}

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  pendiente: 'Pendiente',
  asignada: 'Asignada',
  preparando: 'Preparando',
  en_ruta: 'En ruta',
  proxima: 'Proxima',
  en_cliente: 'En cliente',
  visita_detectada: 'Visita detectada',
  completada: 'Completada',
  incidencia: 'Incidencia',
  cancelada: 'Cancelada',
};

const WORK_ORDER_TONE: Record<WorkOrderStatus, Tone> = {
  pendiente: 'neutral',
  asignada: 'neutral',
  preparando: 'brand',
  en_ruta: 'moving',
  proxima: 'warning',
  en_cliente: 'warning',
  visita_detectada: 'active',
  completada: 'active',
  incidencia: 'danger',
  cancelada: 'neutral',
};

export function WorkOrderStatusBadge({
  status,
  size,
}: {
  status: WorkOrderStatus;
  size?: BadgeProps['size'];
}) {
  return (
    <Badge tone={WORK_ORDER_TONE[status]} size={size} dot>
      {WORK_ORDER_STATUS_LABEL[status]}
    </Badge>
  );
}

export const PRIORITY_LABEL: Record<WorkOrderPriority, string> = {
  baja: 'Baja',
  normal: 'Normal',
  alta: 'Alta',
  urgente: 'Urgente',
};

const PRIORITY_TONE: Record<WorkOrderPriority, Tone> = {
  baja: 'neutral',
  normal: 'neutral',
  alta: 'warning',
  urgente: 'danger',
};

export function PriorityBadge({ priority }: { priority: WorkOrderPriority }) {
  // La prioridad normal es la mayoria: destacarla seria ruido visual.
  if (priority === 'normal') return null;
  return <Badge tone={PRIORITY_TONE[priority]}>{PRIORITY_LABEL[priority]}</Badge>;
}

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  critical: 'Critica',
  warning: 'Advertencia',
  info: 'Informativa',
};

const SEVERITY_TONE: Record<AlertSeverity, Tone> = {
  critical: 'danger',
  warning: 'warning',
  info: 'brand',
};

export function SeverityBadge({ severity, size }: { severity: AlertSeverity; size?: BadgeProps['size'] }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} size={size} dot>
      {SEVERITY_LABEL[severity]}
    </Badge>
  );
}

/**
 * Confirmacion de entrega.
 *
 * Nunca se colapsan los origenes: una presencia detectada por GPS no es lo
 * mismo que una entrega que el conductor confirmo en terreno, ni que una que
 * un administrador valido a mano. Quien audita necesita saber cual fue.
 */
const CONFIRMATION_LABEL: Record<DeliveryConfirmationSource, string> = {
  gps: 'Detectada por GPS',
  driver: 'Confirmada por el conductor',
  admin: 'Validada por administracion',
  manual: 'Confirmada manualmente',
  none: '',
};

const CONFIRMATION_TONE: Record<DeliveryConfirmationSource, Tone> = {
  gps: 'moving',
  driver: 'active',
  admin: 'brand',
  manual: 'active',
  none: 'neutral',
};

export function DeliveryConfirmationBadge({ source }: { source: DeliveryConfirmationSource }) {
  if (source === 'none') return null;
  return <Badge tone={CONFIRMATION_TONE[source]}>{CONFIRMATION_LABEL[source]}</Badge>;
}
