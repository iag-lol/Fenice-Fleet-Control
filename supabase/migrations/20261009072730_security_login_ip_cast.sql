create or replace function public.fenice_login_success(p_user_id uuid, p_password_hash text, p_ip text)
returns boolean language plpgsql security invoker set search_path = '' as $$
begin
  update public.usuarios set intentos_fallidos=0,bloqueado_hasta=null,
    ultimo_login_at=now(),ultimo_login_ip=p_ip::inet
    where id=p_user_id and activo=true and password_hash=p_password_hash
      and (bloqueado_hasta is null or bloqueado_hasta<=now());
  return found;
end;
$$;
revoke all on function public.fenice_login_success(uuid,text,text) from public,anon,authenticated;
grant execute on function public.fenice_login_success(uuid,text,text) to service_role;
