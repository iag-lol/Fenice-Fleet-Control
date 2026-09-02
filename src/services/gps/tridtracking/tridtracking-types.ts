/**
 * Formas de respuesta de 3DTracking (Client WebApi v1.0).
 *
 * Copian el contrato publicado en https://apiv2.3dtracking.net/docs/v1/ y no
 * se usan fuera de este directorio: el resto del sistema solo conoce los
 * tipos de `@/types/core`. Todo lo que llega se declara OPCIONAL a
 * proposito — una respuesta real trae campos vacios, nulos o ausentes segun
 * el equipo, y asumir que estan seria la forma mas rapida de romperse en
 * produccion.
 */

export interface TridStatus {
  Result?: string | null;
  ErrorCode?: string | null;
  Message?: string | null;
}

export interface TridAuthResponse {
  Status?: TridStatus | null;
  Result?: {
    UserIdGuid?: string | null;
    SessionId?: string | null;
  } | null;
}

export interface TridPosition {
  Latitude?: number | null;
  Longitude?: number | null;
  Address?: string | null;
  Speed?: number | null;
  /** Unidad de `Speed`. Varia por cuenta: "km/h", "kph", "mph"... */
  SpeedMeasure?: string | null;
  Heading?: number | null;
  /** Texto, no booleano: "On", "Off", "" segun el equipo. */
  Ignition?: string | null;
  Odometer?: number | null;
  EngineTime?: number | null;
  EngineStatus?: string | null;
  ServerTimeUTC?: string | null;
  GPSTimeLocal?: string | null;
  GPSTimeUtc?: string | null;
  Driver?: { Uid?: string | null; Name?: string | null } | null;
}

export interface TridUnit {
  Uid?: string | null;
  Name?: string | null;
  Imei?: string | null;
  Status?: string | null;
  GroupName?: string | null;
  CompanyName?: string | null;
  PhoneNumber?: string | null;
  UnitType?: string | null;
  Information?: string | null;
  CreatedDateTimeUtc?: string | null;
  DriverUid?: string | null;
  LastReportedTimeUTC?: string | null;
  LastReportedTimeLocal?: string | null;
  OdometerDetails?: { Reading?: number | null; DateTime?: string | null } | null;
  Position?: TridPosition | null;
}

export interface TridAlert {
  Uid?: string | null;
  UnitUid?: string | null;
  AlertType?: string | null;
  AlertTypeName?: string | null;
  Description?: string | null;
  DateTimeUtc?: string | null;
  Latitude?: number | null;
  Longitude?: number | null;
}
