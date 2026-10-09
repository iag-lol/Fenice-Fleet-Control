/** Nombres comerciales de integración no forman parte de la interfaz de Fleet Control. */
export function gpsDisplayText(value: string | null | undefined): string {
  return (value ?? '')
    .replace(/teltonika\s*/gi, '')
    .replace(/3d\s*tracking|traccar(?:\s+client)?|m[oó]vilmaster|mci\s*telecom|\bmci\b/gi, 'GPS')
    .replace(/\bGPS\s+GPS\b/g, 'GPS').trim();
}
