alter table public.vehiculos add column if not exists grupo_vehiculo text
  check (grupo_vehiculo in ('camiones', 'camionetas', 'personal'));
alter table public.vehiculos drop constraint if exists vehiculos_tipo_valido;
alter table public.vehiculos add constraint vehiculos_tipo_valido
  check (tipo in ('sin_dato', 'cisterna_semirremolque', 'cisterna_rigido', 'camioneta_estanque', 'personal'));
update public.vehiculos set grupo_vehiculo = case
  when tipo in ('cisterna_semirremolque', 'cisterna_rigido') then 'camiones'
  when tipo = 'camioneta_estanque' then 'camionetas'
  when tipo = 'personal' then 'personal'
end where grupo_vehiculo is null and tipo <> 'sin_dato';
comment on column public.vehiculos.grupo_vehiculo is 'Grupo editable de flota; camiones y camionetas componen carga de combustible.';
