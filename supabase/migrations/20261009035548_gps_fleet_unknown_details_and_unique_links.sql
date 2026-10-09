-- Registro GPS previo a la ficha técnica: 0 = sin dato, no una medición.
alter table public.vehiculos drop constraint if exists vehiculos_capacidad_litros_check;
alter table public.vehiculos add constraint vehiculos_capacidad_litros_check check (capacidad_litros >= 0);
alter table public.vehiculos drop constraint if exists vehiculos_compartimentos_check;
alter table public.vehiculos add constraint vehiculos_compartimentos_check check (compartimentos >= 0);
comment on column public.vehiculos.capacidad_litros is 'Capacidad real en litros; 0 indica que aún no está informada.';
comment on column public.vehiculos.compartimentos is 'Cantidad real de compartimentos; 0 indica que aún no está informada.';
-- Cada equipo físico solo puede estar vinculado a un vehículo.
create unique index if not exists vehiculos_dispositivo_unico
  on public.vehiculos(dispositivo_id) where dispositivo_id is not null;
notify pgrst, 'reload schema';
