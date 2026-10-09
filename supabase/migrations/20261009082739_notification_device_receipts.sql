alter table public.notificaciones_envios add column if not exists recibida_at timestamptz;
alter table public.notificaciones_envios add column if not exists mostrada_at timestamptz;
notify pgrst,'reload schema';
