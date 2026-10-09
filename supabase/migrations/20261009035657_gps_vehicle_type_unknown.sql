-- Un GPS no acredita la configuración física del camión.
alter table public.vehiculos drop constraint if exists vehiculos_tipo_valido;
alter table public.vehiculos add constraint vehiculos_tipo_valido
  check (tipo in ('sin_dato', 'cisterna_semirremolque', 'cisterna_rigido', 'camioneta_estanque'));
notify pgrst, 'reload schema';
