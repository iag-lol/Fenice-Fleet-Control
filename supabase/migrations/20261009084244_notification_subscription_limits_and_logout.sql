create or replace function public.fenice_save_push_subscription(p_user uuid,p_session uuid,p_hash text,p_cipher text,p_sound boolean,p_preview boolean,p_severity text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare result uuid; existing uuid; active_count integer;
begin
 perform 1 from public.usuarios where id=p_user and activo and rol in ('administrador','supervisor','operador','invitado') for update;
 if not found or not exists(select 1 from public.sesiones where id=p_session and usuario_id=p_user and revocada_at is null and expira_at>now()) then
  raise exception 'Invalid session';
 end if;
 select id into existing from public.notificaciones_suscripciones where endpoint_hash=p_hash and usuario_id=p_user;
 if existing is null then
  select count(*) into active_count from public.notificaciones_suscripciones p join public.sesiones s on s.id=p.sesion_id
   where p.usuario_id=p_user and p.habilitada and s.revocada_at is null and s.expira_at>now();
  if active_count>=10 then raise exception 'Device limit reached'; end if;
 end if;
 insert into public.notificaciones_suscripciones(usuario_id,sesion_id,endpoint_hash,suscripcion_cifrada,sonido,mostrar_detalle,severidad_minima)
 values(p_user,p_session,p_hash,p_cipher,p_sound,p_preview,p_severity)
 on conflict(endpoint_hash) do update set usuario_id=excluded.usuario_id,sesion_id=excluded.sesion_id,
 suscripcion_cifrada=excluded.suscripcion_cifrada,sonido=excluded.sonido,mostrar_detalle=excluded.mostrar_detalle,
 severidad_minima=excluded.severidad_minima,habilitada=true,actualizado_at=now()
 returning id into result;
 return result;
end; $$;
create or replace function public.fenice_cancel_old_push_bindings()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.usuario_id<>old.usuario_id or new.sesion_id<>old.sesion_id or not new.habilitada then
  update public.notificaciones_envios set estado='cancelada',lease_until=null
   where suscripcion_id=new.id and estado in ('pendiente','procesando');
 end if;
 return new;
end; $$;
drop trigger if exists fenice_push_binding_changed on public.notificaciones_suscripciones;
create trigger fenice_push_binding_changed after update on public.notificaciones_suscripciones for each row execute function public.fenice_cancel_old_push_bindings();
create or replace function public.fenice_disable_session_push()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.revocada_at is not null then
  update public.notificaciones_suscripciones set habilitada=false where sesion_id=new.id and habilitada;
 end if;
 return new;
end; $$;
drop trigger if exists fenice_push_session_revoked on public.sesiones;
create trigger fenice_push_session_revoked after update of revocada_at on public.sesiones for each row execute function public.fenice_disable_session_push();
revoke all on function public.fenice_save_push_subscription(uuid,uuid,text,text,boolean,boolean,text),public.fenice_cancel_old_push_bindings(),public.fenice_disable_session_push() from public,anon,authenticated;
grant execute on function public.fenice_save_push_subscription(uuid,uuid,text,text,boolean,boolean,text),public.fenice_cancel_old_push_bindings(),public.fenice_disable_session_push() to service_role;
notify pgrst,'reload schema';
