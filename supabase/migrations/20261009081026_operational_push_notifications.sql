-- Suscripciones privadas por equipo y sesion; el endpoint y las claves van cifrados.
alter table public.alertas add column if not exists notification_revision integer not null default 1;
create table if not exists public.notificaciones_suscripciones (
 id uuid primary key default gen_random_uuid(),
 usuario_id uuid not null references public.usuarios(id) on delete cascade,
 sesion_id uuid not null references public.sesiones(id) on delete cascade,
 endpoint_hash text not null unique,
 suscripcion_cifrada text not null,
 habilitada boolean not null default true,
 sonido boolean not null default true,
 mostrar_detalle boolean not null default false,
 severidad_minima text not null default 'info' check(severidad_minima in ('info','warning','critical')),
 creado_at timestamptz not null default now(),
 actualizado_at timestamptz not null default now(),
 check(length(endpoint_hash)=64)
);
create table if not exists public.notificaciones_envios (
 id uuid primary key default gen_random_uuid(),
 suscripcion_id uuid not null references public.notificaciones_suscripciones(id) on delete cascade,
 alerta_id text references public.alertas(id) on delete cascade,
 revision integer not null default 1,
 tipo text not null default 'alerta' check(tipo in ('alerta','prueba')),
 estado text not null default 'pendiente' check(estado in ('pendiente','procesando','enviada','fallida','cancelada')),
 intentos integer not null default 0,
 proximo_intento_at timestamptz not null default now(),
 expira_at timestamptz not null default now()+interval '15 minutes',
 lease_until timestamptz,
 lease_token uuid,
 enviado_at timestamptz,
 ultimo_codigo text,
 creado_at timestamptz not null default now(),
 unique(suscripcion_id,alerta_id,revision),
 check((tipo='alerta' and alerta_id is not null) or (tipo='prueba' and alerta_id is null))
);
create index if not exists idx_notificaciones_sesion on public.notificaciones_suscripciones(sesion_id) where habilitada;
create index if not exists idx_notificaciones_usuario on public.notificaciones_suscripciones(usuario_id);
create index if not exists idx_notificaciones_pendientes on public.notificaciones_envios(proximo_intento_at) where estado in ('pendiente','procesando');
create index if not exists idx_notificaciones_suscripcion on public.notificaciones_envios(suscripcion_id);
create index if not exists idx_notificaciones_alerta on public.notificaciones_envios(alerta_id);
alter table public.notificaciones_suscripciones enable row level security;
alter table public.notificaciones_envios enable row level security;
revoke all on public.notificaciones_suscripciones,public.notificaciones_envios from public,anon,authenticated;
grant select,insert,update,delete on public.notificaciones_suscripciones,public.notificaciones_envios to service_role;

create or replace function public.fenice_alert_notification_revision()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if (old.estado='resuelta' and new.estado='nueva') or
    (case new.severidad when 'critical' then 2 when 'warning' then 1 else 0 end >
     case old.severidad when 'critical' then 2 when 'warning' then 1 else 0 end) then
  new.notification_revision := old.notification_revision+1;
 end if;
 return new;
end; $$;
drop trigger if exists fenice_alert_revision on public.alertas;
create trigger fenice_alert_revision before update on public.alertas for each row execute function public.fenice_alert_notification_revision();

create or replace function public.fenice_queue_alert_notifications()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.estado<>'nueva' then return new; end if;
 if tg_op='UPDATE' then
  if new.notification_revision=old.notification_revision then return new; end if;
 end if;
 if new.marca_tiempo<now()-interval '15 minutes' or new.marca_tiempo>now()+interval '1 minute' then return new; end if;
 insert into public.notificaciones_envios(suscripcion_id,alerta_id,revision)
 select p.id,new.id,new.notification_revision
 from public.notificaciones_suscripciones p
 join public.usuarios u on u.id=p.usuario_id
 join public.sesiones s on s.id=p.sesion_id and s.usuario_id=p.usuario_id
 where p.habilitada and u.activo and u.rol in ('administrador','supervisor','operador','invitado')
 and s.revocada_at is null and s.expira_at>now()
 and (case new.severidad when 'critical' then 2 when 'warning' then 1 else 0 end >=
      case p.severidad_minima when 'critical' then 2 when 'warning' then 1 else 0 end)
 on conflict(suscripcion_id,alerta_id,revision) do nothing;
 return new;
end; $$;
drop trigger if exists fenice_alert_push on public.alertas;
create trigger fenice_alert_push after insert or update on public.alertas for each row execute function public.fenice_queue_alert_notifications();

create or replace function public.fenice_claim_notifications(p_limit integer default 20)
returns table(id uuid,lease_token uuid,suscripcion_id uuid,endpoint_hash text,suscripcion_cifrada text,
 sonido boolean,mostrar_detalle boolean,tipo text,intentos integer,alerta_id text,revision integer,
 severidad text,titulo text,descripcion text,marca_tiempo timestamptz)
language sql security invoker set search_path='' as $$
 with eligible as (
  select d.id from public.notificaciones_envios d
  join public.notificaciones_suscripciones p on p.id=d.suscripcion_id
  join public.usuarios u on u.id=p.usuario_id
  join public.sesiones s on s.id=p.sesion_id and s.usuario_id=p.usuario_id
  left join public.alertas a on a.id=d.alerta_id
  where d.estado in ('pendiente','procesando') and d.intentos<6 and d.expira_at>now()
  and d.proximo_intento_at<=now() and (d.lease_until is null or d.lease_until<now())
  and p.habilitada and u.activo and u.rol in ('administrador','supervisor','operador','invitado')
  and s.revocada_at is null and s.expira_at>now()
  and (d.tipo='prueba' or (a.estado='nueva' and a.notification_revision=d.revision and
    (case a.severidad when 'critical' then 2 when 'warning' then 1 else 0 end >=
     case p.severidad_minima when 'critical' then 2 when 'warning' then 1 else 0 end)))
  order by d.creado_at limit greatest(1,least(p_limit,50)) for update of d skip locked
 ), claimed as (
  update public.notificaciones_envios d set estado='procesando',intentos=d.intentos+1,
    lease_until=now()+interval '60 seconds',lease_token=gen_random_uuid()
  where d.id in (select e.id from eligible e) returning d.*
 )
 select c.id,c.lease_token,c.suscripcion_id,p.endpoint_hash,p.suscripcion_cifrada,p.sonido,p.mostrar_detalle,
 c.tipo,c.intentos,c.alerta_id,c.revision,a.severidad,a.titulo,a.descripcion,a.marca_tiempo
 from claimed c join public.notificaciones_suscripciones p on p.id=c.suscripcion_id
 left join public.alertas a on a.id=c.alerta_id;
$$;
revoke all on function public.fenice_alert_notification_revision(),public.fenice_queue_alert_notifications(),public.fenice_claim_notifications(integer) from public,anon,authenticated;
grant execute on function public.fenice_alert_notification_revision(),public.fenice_queue_alert_notifications(),public.fenice_claim_notifications(integer) to service_role;
notify pgrst,'reload schema';
-- Revalidar inmediatamente antes de cada envio, incluso si ya se tomo el trabajo.
create or replace function public.fenice_notification_authorized(p_job uuid,p_lease uuid)
returns boolean language sql security invoker set search_path='' as $$
 select exists(
  select 1 from public.notificaciones_envios d
  join public.notificaciones_suscripciones p on p.id=d.suscripcion_id
  join public.usuarios u on u.id=p.usuario_id
  join public.sesiones s on s.id=p.sesion_id and s.usuario_id=p.usuario_id
  left join public.alertas a on a.id=d.alerta_id
  where d.id=p_job and d.lease_token=p_lease and d.estado='procesando' and d.expira_at>now()
  and p.habilitada and u.activo and u.rol in ('administrador','supervisor','operador','invitado')
  and s.revocada_at is null and s.expira_at>now()
  and (d.tipo='prueba' or (a.estado='nueva' and a.notification_revision=d.revision))
 );
$$;
revoke all on function public.fenice_notification_authorized(uuid,uuid) from public,anon,authenticated;
grant execute on function public.fenice_notification_authorized(uuid,uuid) to service_role;
