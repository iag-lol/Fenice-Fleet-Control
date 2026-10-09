-- Bloqueo por cuenta atomico. Solo el backend de la plataforma puede invocarlo.
create or replace function public.fenice_login_failure(p_user_id uuid, p_max_attempts integer, p_lock_minutes integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare failed integer;
begin
  if p_max_attempts not between 1 and 20 or p_lock_minutes not between 1 and 1440 then
    raise exception 'Invalid lock policy';
  end if;
  select case when bloqueado_hasta is not null and bloqueado_hasta <= now() then 0 else intentos_fallidos end
    into failed from public.usuarios where id=p_user_id for update;
  if not found then return; end if;
  failed := failed + 1;
  update public.usuarios set intentos_fallidos=failed,
    bloqueado_hasta=case when failed >= p_max_attempts then now()+make_interval(mins=>p_lock_minutes) else null end
    where id=p_user_id;
end;
$$;
create or replace function public.fenice_login_success(p_user_id uuid, p_password_hash text, p_ip text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.usuarios set intentos_fallidos=0,bloqueado_hasta=null,
    ultimo_login_at=now(),ultimo_login_ip=p_ip
    where id=p_user_id and activo=true and password_hash=p_password_hash
      and (bloqueado_hasta is null or bloqueado_hasta<=now());
  return found;
end;
$$;
revoke all on function public.fenice_login_failure(uuid,integer,integer) from public,anon,authenticated;
revoke all on function public.fenice_login_success(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fenice_login_failure(uuid,integer,integer) to service_role;
grant execute on function public.fenice_login_success(uuid,text,text) to service_role;
-- Nuevos objetos no deben heredar acceso publico por accidente.
alter default privileges for role postgres in schema public revoke all on tables from anon,authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon,authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public,anon,authenticated;
