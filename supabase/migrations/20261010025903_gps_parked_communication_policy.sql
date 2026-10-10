-- Plazo configurable para avisar cuando el ultimo contacto reportado esta apagado.
alter table public.configuracion_operacional
  add column if not exists gps_segundos_offline_contacto_apagado integer not null default 86400
  check (gps_segundos_offline_contacto_apagado between 600 and 604800);
