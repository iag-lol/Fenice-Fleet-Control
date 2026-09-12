-- =============================================================================
-- FENICE FLEET CONTROL — Esquema de la base interna de la plataforma
-- =============================================================================
--
-- Que vive aqui: login propio (usuarios/sesiones), flota (camiones,
-- conductores, dispositivos GPS), rutas y sus paradas, geocercas
-- ("ubicaciones") y sus eventos, alertas, configuracion operacional,
-- evidencia de entrega y el registro de enlaces del portal del conductor.
--
-- Que NO vive aqui, a proposito: clientes, direcciones de cliente, pedidos y
-- ordenes de trabajo (despachos). Esos siguen viviendo en la base externa de
-- Fenice, de SOLO LECTURA (ver docs/EXTERNAL-DATABASE-INTEGRATION.md). Las
-- columnas de esta base que necesitan referenciarlos (`orden_trabajo_id`,
-- `cliente_id`) son TEXTO LIBRE sin llave foranea: son identificadores
-- opacos hacia un sistema que vive en otra base de datos, no relaciones que
-- Postgres pueda validar.
--
-- Esta plataforma NO usa Supabase Auth. El login valida RUT y contrasena
-- contra la tabla `usuarios` desde el servidor (con la service role key,
-- que se salta Row Level Security), y emite sus propias sesiones en
-- `sesiones`. Por eso todas las tablas de aqui abajo tienen RLS habilitado
-- SIN ninguna politica permisiva: es un cierre por defecto para el caso de
-- que, en el futuro, alguien exponga la anon key sin darse cuenta. La
-- service role key ignora RLS igualmente, asi que esto no afecta a la
-- aplicacion — es una defensa en profundidad, no el mecanismo principal.
--
-- Como aplicar este archivo:
--   1. Crea un proyecto en supabase.com (o usa uno existente, vacio).
--   2. Pega este archivo completo en el SQL Editor de Supabase y ejecutalo.
--      Es idempotente: se puede volver a correr sin duplicar nada.
--   3. Copia la "Project URL" y la "service_role key" (Settings → API) a
--      SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en tu `.env.local`.
--   4. Crea el primer administrador con:  npm run create:admin
--
-- Ver docs/SUPABASE-INTEGRATION.md para el detalle completo.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Extensiones
-- -----------------------------------------------------------------------------
-- `gen_random_uuid()` para las llaves primarias. Supabase suele traerla
-- habilitada por defecto; se declara igual para que este script funcione en
-- cualquier proyecto nuevo.
create extension if not exists pgcrypto;


-- -----------------------------------------------------------------------------
-- Utilidad compartida: mantener `actualizado_at` al dia
-- -----------------------------------------------------------------------------
create or replace function fenice_set_actualizado_at()
returns trigger
language plpgsql
as $$
begin
  new.actualizado_at = now();
  return new;
end;
$$;


-- =============================================================================
-- 1. AUTENTICACION Y AUDITORIA
-- =============================================================================

-- --- usuarios ----------------------------------------------------------------
-- Login propio: RUT + contrasena (hash bcrypt). Sin Supabase Auth.
create table if not exists usuarios (
  id                 uuid primary key default gen_random_uuid(),
  rut                text not null unique,
  nombre_completo    text not null,
  email              text unique,
  password_hash      text not null,
  rol                text not null default 'operador',
  activo             boolean not null default true,
  intentos_fallidos  integer not null default 0,
  bloqueado_hasta    timestamptz,
  ultimo_login_at    timestamptz,
  ultimo_login_ip    inet,
  creado_at          timestamptz not null default now(),
  actualizado_at     timestamptz not null default now(),
  creado_por         uuid references usuarios(id) on delete set null,

  constraint usuarios_rol_valido
    check (rol in ('administrador', 'supervisor', 'operador', 'invitado')),
  -- Forma canonica que produce `src/lib/rut.ts`: cuerpo numerico, guion,
  -- digito verificador (0-9 o K). No sustituye la validacion del digito
  -- verificador, que ocurre en la aplicacion.
  constraint usuarios_rut_formato
    check (rut ~ '^[0-9]{1,8}-[0-9K]$')
);
comment on table usuarios is 'Usuarios con acceso a la plataforma (login por RUT y contrasena).';
comment on column usuarios.password_hash is 'Hash bcrypt (costo 12). Nunca se guarda ni se registra la contrasena en texto plano.';

drop trigger if exists trg_usuarios_actualizado_at on usuarios;
create trigger trg_usuarios_actualizado_at
  before update on usuarios
  for each row execute function fenice_set_actualizado_at();

alter table usuarios enable row level security;


-- --- sesiones ------------------------------------------------------------
-- La cookie del navegador solo lleva un token opaco; aqui se guarda su hash,
-- nunca el token en si (ver src/lib/session.ts).
create table if not exists sesiones (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  token_hash      text not null unique,
  creado_at       timestamptz not null default now(),
  expira_at       timestamptz not null,
  ultimo_uso_at   timestamptz not null default now(),
  revocada_at     timestamptz,
  ip_creacion     inet,
  user_agent      text
);
comment on table sesiones is 'Sesiones de login activas. Solo se guarda el SHA-256 del token de la cookie.';

create index if not exists idx_sesiones_usuario on sesiones(usuario_id);
create index if not exists idx_sesiones_vigentes on sesiones(expira_at) where revocada_at is null;

alter table sesiones enable row level security;


-- --- intentos_login --------------------------------------------------------
-- Auditoria de login y base del bloqueo por intentos (por cuenta y por IP).
create table if not exists intentos_login (
  id             bigint generated always as identity primary key,
  rut_intentado  text,
  exitoso        boolean not null,
  motivo         text,
  ip             inet,
  user_agent     text,
  creado_at      timestamptz not null default now(),

  constraint intentos_login_motivo_valido
    check (motivo is null or motivo in (
      'credenciales_invalidas', 'usuario_inactivo', 'usuario_bloqueado', 'rut_invalido'
    ))
);
comment on table intentos_login is 'Auditoria de cada intento de login, exitoso o no. Base del bloqueo por intentos.';

create index if not exists idx_intentos_login_rut on intentos_login(rut_intentado, creado_at desc);
create index if not exists idx_intentos_login_ip on intentos_login(ip, creado_at desc);

alter table intentos_login enable row level security;


-- --- auditoria ---------------------------------------------------------------
-- Registro general de acciones administrativas (quien cambio que). No es
-- obligatorio para que la plataforma funcione, pero es la primera pregunta
-- ante un incidente: "quien resolvio esta alerta" o "quien edito esta
-- geocerca".
create table if not exists auditoria (
  id          bigint generated always as identity primary key,
  usuario_id  uuid references usuarios(id) on delete set null,
  accion      text not null,
  entidad     text,
  entidad_id  text,
  detalle     jsonb,
  ip          inet,
  creado_at   timestamptz not null default now()
);
comment on table auditoria is 'Registro de acciones administrativas: quien hizo que, y cuando.';

create index if not exists idx_auditoria_usuario on auditoria(usuario_id, creado_at desc);
create index if not exists idx_auditoria_entidad on auditoria(entidad, entidad_id);

alter table auditoria enable row level security;


-- =============================================================================
-- 2. FLOTA
-- =============================================================================

-- --- dispositivos_gps ---------------------------------------------------------
create table if not exists dispositivos_gps (
  id                    uuid primary key default gen_random_uuid(),
  imei                  text not null unique,
  modelo                text not null default '',
  sim_numero            text,
  proveedor_id_externo  text,
  instalado_at          timestamptz,
  proveedor             text not null default 'traccar',
  servidor_url          text,
  habilitado            boolean not null default true,
  ultima_conexion_at    timestamptz,
  creado_at             timestamptz not null default now(),
  actualizado_at        timestamptz not null default now(),

  constraint dispositivos_gps_proveedor_valido check (proveedor in ('traccar', '3dtracking'))
);
comment on table dispositivos_gps is 'Equipos GPS instalados en los camiones (Traccar / 3DTracking).';
comment on column dispositivos_gps.imei is 'Identificador del dispositivo tal como lo reporta el equipo: IMEI real en un Teltonika, o el "Device Identifier" configurado en Traccar Client.';
comment on column dispositivos_gps.proveedor_id_externo is 'Identificador NUMERICO interno que Traccar/3DTracking asigna al dispositivo (deviceId), resuelto automaticamente a partir del imei. No lo ingresa el operador.';
comment on column dispositivos_gps.servidor_url is 'Servidor Traccar de ESTE dispositivo. Vacio = usa el servidor configurado por variables de entorno (TRACCAR_BASE_URL), que es el caso normal cuando toda la flota comparte un unico servidor.';
comment on column dispositivos_gps.habilitado is 'Permite pausar la conexion sin perder la asociacion (ej. equipo retirado temporalmente).';
comment on column dispositivos_gps.ultima_conexion_at is 'Ultima vez que se confirmo una conexion exitosa (prueba manual o telemetria recibida). Alimenta el diagnostico de "Conectar GPS", no el estado en vivo del mapa.';

-- Columnas nuevas sobre una tabla creada por una version anterior de este
-- script: `create table if not exists` no la modifica, así que se agregan
-- aparte para que volver a correr este archivo siga siendo seguro.
alter table dispositivos_gps add column if not exists proveedor text not null default 'traccar';
alter table dispositivos_gps add column if not exists servidor_url text;
alter table dispositivos_gps add column if not exists habilitado boolean not null default true;
alter table dispositivos_gps add column if not exists ultima_conexion_at timestamptz;
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'dispositivos_gps_proveedor_valido'
  ) then
    alter table dispositivos_gps
      add constraint dispositivos_gps_proveedor_valido check (proveedor in ('traccar', '3dtracking'));
  end if;
end $$;

drop trigger if exists trg_dispositivos_gps_actualizado_at on dispositivos_gps;
create trigger trg_dispositivos_gps_actualizado_at
  before update on dispositivos_gps
  for each row execute function fenice_set_actualizado_at();

alter table dispositivos_gps enable row level security;


-- --- conductores ---------------------------------------------------------------
create table if not exists conductores (
  id                    uuid primary key default gen_random_uuid(),
  nombre_completo       text not null,
  documento_identidad   text not null unique,
  telefono              text not null default '',
  clase_licencia        text not null default '',
  licencia_vencimiento  date,
  activo                boolean not null default true,
  creado_at             timestamptz not null default now(),
  actualizado_at        timestamptz not null default now()
);
comment on table conductores is 'Conductores de la flota. No tienen login: acceden por el enlace firmado de su ruta (ver enlaces_conductor).';
comment on column conductores.documento_identidad is 'RUT del conductor. No es credencial de acceso: el conductor no inicia sesion.';

drop trigger if exists trg_conductores_actualizado_at on conductores;
create trigger trg_conductores_actualizado_at
  before update on conductores
  for each row execute function fenice_set_actualizado_at();

alter table conductores enable row level security;


-- --- vehiculos -------------------------------------------------------------
create table if not exists vehiculos (
  id                 uuid primary key default gen_random_uuid(),
  patente            text not null unique,
  codigo_flota       text not null unique,
  marca              text not null default '',
  modelo             text not null default '',
  anio               integer,
  tipo               text not null default 'cisterna_semirremolque',
  capacidad_litros   numeric not null check (capacidad_litros > 0),
  compartimentos     integer not null default 1 check (compartimentos > 0),
  dispositivo_id     uuid references dispositivos_gps(id) on delete set null,
  conductor_id       uuid references conductores(id) on delete set null,
  base_despacho      text,
  activo             boolean not null default true,
  creado_at          timestamptz not null default now(),
  actualizado_at     timestamptz not null default now(),

  constraint vehiculos_tipo_valido
    check (tipo in ('cisterna_semirremolque', 'cisterna_rigido', 'camioneta_estanque'))
);
comment on table vehiculos is 'Camiones cisterna de la flota.';
comment on column vehiculos.base_despacho is 'Planta de almacenamiento de origen (texto libre).';

create index if not exists idx_vehiculos_conductor on vehiculos(conductor_id);

drop trigger if exists trg_vehiculos_actualizado_at on vehiculos;
create trigger trg_vehiculos_actualizado_at
  before update on vehiculos
  for each row execute function fenice_set_actualizado_at();

alter table vehiculos enable row level security;


-- =============================================================================
-- 3. RUTAS
-- =============================================================================

-- --- rutas -------------------------------------------------------------------
create table if not exists rutas (
  id                          uuid primary key default gen_random_uuid(),
  codigo                      text not null unique,
  nombre                      text not null,
  fecha                       timestamptz not null,
  vehiculo_id                 uuid references vehiculos(id) on delete set null,
  conductor_id                uuid references conductores(id) on delete set null,
  estado                      text not null default 'planificada',
  comunas_autorizadas         text[] not null default '{}',
  trazado_planificado         jsonb not null default '[]',
  trazado_ejecutado           jsonb not null default '[]',
  distancia_planificada_km    numeric not null default 0,
  iniciada_at                 timestamptz,
  completada_at               timestamptz,
  creado_at                   timestamptz not null default now(),
  actualizado_at              timestamptz not null default now(),
  creado_por                  uuid references usuarios(id) on delete set null,

  constraint rutas_estado_valido
    check (estado in ('planificada', 'en_curso', 'completada', 'cancelada'))
);
comment on table rutas is 'Rutas planificadas: vehiculo, conductor, corredor y comunas autorizadas.';
comment on column rutas.trazado_planificado is 'Corredor planificado: arreglo de {lat, lng} en jsonb.';
comment on column rutas.trazado_ejecutado is 'Traza realmente recorrida, alimentada por el historial GPS.';

create index if not exists idx_rutas_fecha on rutas(fecha desc);
create index if not exists idx_rutas_vehiculo on rutas(vehiculo_id);

drop trigger if exists trg_rutas_actualizado_at on rutas;
create trigger trg_rutas_actualizado_at
  before update on rutas
  for each row execute function fenice_set_actualizado_at();

alter table rutas enable row level security;


-- --- paradas_ruta --------------------------------------------------------------
create table if not exists paradas_ruta (
  id                        uuid primary key default gen_random_uuid(),
  ruta_id                   uuid not null references rutas(id) on delete cascade,
  secuencia                 integer not null,
  -- Referencias OPACAS al ERP externo de Fenice: NO son llaves foraneas.
  -- El pedido, la OT y el cliente siguen viviendo en esa base, de solo
  -- lectura; aqui solo se guarda su identificador como texto.
  orden_trabajo_id          text not null,
  cliente_id                text not null,
  cliente_nombre            text not null default '',
  direccion                 text not null default '',
  comuna_nombre             text not null default '',
  comuna_codigo             text,
  lat                       double precision,
  lng                       double precision,
  llegada_planificada_at    timestamptz,
  llegada_real_at           timestamptz,
  estado                    text not null default 'pendiente',

  constraint paradas_ruta_secuencia_unica unique (ruta_id, secuencia),
  constraint paradas_ruta_estado_valido
    check (estado in (
      'pendiente', 'asignada', 'preparando', 'en_ruta', 'proxima', 'en_cliente',
      'visita_detectada', 'completada', 'incidencia', 'cancelada'
    ))
);
comment on table paradas_ruta is 'Paradas planificadas de cada ruta, en orden de secuencia.';
comment on column paradas_ruta.orden_trabajo_id is 'Referencia opaca a la OT en el ERP de Fenice. Sin llave foranea: esa tabla no vive en esta base.';
comment on column paradas_ruta.cliente_id is 'Referencia opaca al cliente en el ERP de Fenice. Sin llave foranea.';

create index if not exists idx_paradas_ruta_orden_trabajo on paradas_ruta(orden_trabajo_id);

alter table paradas_ruta enable row level security;


-- =============================================================================
-- 4. UBICACIONES: GEOCERCAS Y SUS EVENTOS
-- =============================================================================

-- --- geocercas -----------------------------------------------------------------
create table if not exists geocercas (
  id                        uuid primary key default gen_random_uuid(),
  nombre                    text not null,
  descripcion               text,
  tipo                      text not null default 'personalizada',
  -- {shape:'circle', center:{lat,lng}, radiusMeters} | {shape:'polygon', vertices:[...]}
  geometria                 jsonb not null,
  -- Referencia opaca (cliente, ruta o texto libre segun el tipo). Sin FK.
  referencia_id             text,
  cliente_id                text,
  ruta_id                   uuid references rutas(id) on delete set null,
  vehiculo_id               uuid references vehiculos(id) on delete set null,
  comuna_codigo             text,
  permanencia_min_segundos  integer,
  reglas                    jsonb not null default '{}',
  activo                    boolean not null default true,
  color                     text not null default '#0d90ae',
  origen                    text not null default 'manual',
  creado_at                 timestamptz not null default now(),
  actualizado_at            timestamptz,
  creado_por                uuid references usuarios(id) on delete set null,

  constraint geocercas_tipo_valido
    check (tipo in (
      'cliente', 'centro_operacional', 'zona_autorizada', 'zona_restringida',
      'comuna', 'ruta', 'carga', 'descarga', 'personalizada'
    )),
  constraint geocercas_origen_valido check (origen in ('sistema', 'manual')),
  constraint geocercas_geometria_valida
    check (geometria ? 'shape' and (geometria ->> 'shape') in ('circle', 'polygon')),
  constraint geocercas_color_formato check (color ~ '^#[0-9a-fA-F]{6}$')
);
comment on table geocercas is '"Ubicaciones": perimetros de entrega, carga/descarga, zonas autorizadas/restringidas y centros operacionales.';
comment on column geocercas.cliente_id is 'Referencia opaca al cliente en el ERP de Fenice. Sin llave foranea.';
comment on column geocercas.reglas is 'GeofenceRules completo (triggers, ventana horaria, severidad, vehiculos autorizados).';

create index if not exists idx_geocercas_activo on geocercas(activo);
create index if not exists idx_geocercas_ruta on geocercas(ruta_id);
create index if not exists idx_geocercas_vehiculo on geocercas(vehiculo_id);
create index if not exists idx_geocercas_cliente on geocercas(cliente_id);

drop trigger if exists trg_geocercas_actualizado_at on geocercas;
create trigger trg_geocercas_actualizado_at
  before update on geocercas
  for each row execute function fenice_set_actualizado_at();

alter table geocercas enable row level security;


-- --- eventos_geocerca ------------------------------------------------------
create table if not exists eventos_geocerca (
  id                uuid primary key default gen_random_uuid(),
  geocerca_id       uuid not null references geocercas(id) on delete cascade,
  vehiculo_id       uuid references vehiculos(id) on delete set null,
  orden_trabajo_id  text,
  cliente_id        text,
  tipo              text not null,
  marca_tiempo      timestamptz not null default now(),
  lat               double precision not null,
  lng               double precision not null,
  distancia_metros  numeric not null default 0,

  constraint eventos_geocerca_tipo_valido check (tipo in ('enter', 'exit'))
);
comment on table eventos_geocerca is 'Historial de entradas y salidas de geocerca, detectadas por telemetria.';

create index if not exists idx_eventos_geocerca_geocerca on eventos_geocerca(geocerca_id, marca_tiempo desc);
create index if not exists idx_eventos_geocerca_vehiculo on eventos_geocerca(vehiculo_id, marca_tiempo desc);

alter table eventos_geocerca enable row level security;


-- --- visitas_cliente -------------------------------------------------------
create table if not exists visitas_cliente (
  id                        uuid primary key default gen_random_uuid(),
  cliente_id                text not null,
  cliente_nombre            text not null default '',
  vehiculo_id               uuid references vehiculos(id) on delete set null,
  orden_trabajo_id          text,
  geocerca_id               uuid references geocercas(id) on delete set null,
  entrada_at                timestamptz not null,
  salida_at                 timestamptz,
  permanencia_segundos      integer,
  distancia_minima_metros   numeric not null default 0,
  posicion_entrada          jsonb not null,
  confirmada                boolean not null default false
);
comment on table visitas_cliente is 'Visitas de cliente detectadas por GPS: evidencia operacional, no confirmacion de entrega.';
comment on column visitas_cliente.cliente_id is 'Referencia opaca al cliente en el ERP de Fenice. Sin llave foranea.';

create index if not exists idx_visitas_cliente_cliente on visitas_cliente(cliente_id, entrada_at desc);
create index if not exists idx_visitas_cliente_vehiculo on visitas_cliente(vehiculo_id, entrada_at desc);

alter table visitas_cliente enable row level security;


-- --- eventos_entrega -------------------------------------------------------
create table if not exists eventos_entrega (
  id                    uuid primary key default gen_random_uuid(),
  orden_trabajo_id      text not null,
  pedido_id             text,
  cliente_id            text,
  vehiculo_id           uuid references vehiculos(id) on delete set null,
  detectado_at          timestamptz not null default now(),
  origen                text not null default 'gps',
  lat                   double precision,
  lng                   double precision,
  distancia_metros      numeric,
  permanencia_segundos  integer,

  constraint eventos_entrega_origen_valido
    check (origen in ('gps', 'driver', 'admin', 'manual', 'none'))
);
comment on table eventos_entrega is 'Momento en que una visita se convierte en entrega, y por que via se confirmo.';

create index if not exists idx_eventos_entrega_orden_trabajo on eventos_entrega(orden_trabajo_id);

alter table eventos_entrega enable row level security;


-- =============================================================================
-- 5. OPERACION: ALERTAS Y CONFIGURACION
-- =============================================================================

-- --- alertas -----------------------------------------------------------------
-- PK de texto (no uuid): permite upsert idempotente con un id deterministico
-- (ej. "gps-offline:<vehiculoId>"), igual que ya hace el motor de reglas de
-- demostracion. Evita que la misma condicion produzca alertas duplicadas.
create table if not exists alertas (
  id                     text primary key,
  tipo                   text not null,
  categoria              text not null,
  severidad              text not null default 'info',
  titulo                 text not null,
  descripcion            text not null default '',
  marca_tiempo           timestamptz not null default now(),
  vehiculo_id            uuid references vehiculos(id) on delete set null,
  vehiculo_patente       text,
  cliente_id             text,
  cliente_nombre         text,
  orden_trabajo_id       text,
  orden_trabajo_numero   text,
  lat                    double precision,
  lng                    double precision,
  estado                 text not null default 'nueva',
  reconocida_at          timestamptz,
  resuelta_at            timestamptz,
  resuelta_por           uuid references usuarios(id) on delete set null,
  metadata               jsonb,

  constraint alertas_categoria_valida
    check (categoria in ('gps', 'ruta', 'geocerca', 'cliente', 'operacion')),
  constraint alertas_severidad_valida check (severidad in ('info', 'warning', 'critical')),
  constraint alertas_estado_valido check (estado in ('nueva', 'revisada', 'resuelta'))
);
comment on table alertas is 'Alertas operacionales: GPS, ruta, geocerca, cliente y operacion. El estado (nueva/revisada/resuelta) es lo que se edita desde la interfaz.';
comment on column alertas.cliente_id is 'Referencia opaca al cliente en el ERP de Fenice. Sin llave foranea.';

create index if not exists idx_alertas_estado on alertas(estado);
create index if not exists idx_alertas_marca_tiempo on alertas(marca_tiempo desc);
create index if not exists idx_alertas_categoria on alertas(categoria);

alter table alertas enable row level security;


-- --- configuracion_operacional -----------------------------------------------
-- Tabla singleton: la columna `id` solo admite el valor `true`, y al ser
-- primary key impide que exista una segunda fila. Es el equivalente
-- relacional de un unico documento de configuracion.
create table if not exists configuracion_operacional (
  id                                       boolean primary key default true,
  clientes_dias_activo                    integer not null default 21,
  clientes_dias_advertencia               integer not null default 60,
  clientes_usar_visita_como_actividad     boolean not null default false,
  gps_segundos_retraso                    integer not null default 60,
  gps_segundos_posible_perdida            integer not null default 180,
  gps_segundos_offline                    integer not null default 600,
  gps_intervalo_refresco_ms               integer not null default 15000,
  gps_umbral_movimiento_kmh               numeric not null default 3,
  ruta_desvio_metros                      numeric not null default 300,
  ruta_desvio_segundos                    numeric not null default 120,
  ruta_tolerancia_fuera_comuna_segundos    numeric not null default 300,
  ruta_detencion_prolongada_segundos      numeric not null default 900,
  geocerca_radio_defecto_metros           numeric not null default 80,
  geocerca_permanencia_min_segundos       numeric not null default 60,
  geocerca_auto_confirmar_entrega         boolean not null default true,
  actualizado_at                          timestamptz not null default now(),
  actualizado_por                         uuid references usuarios(id) on delete set null,

  constraint configuracion_operacional_singleton check (id)
);
comment on table configuracion_operacional is 'Umbrales operacionales editables desde /configuracion. Una sola fila.';

alter table configuracion_operacional enable row level security;


-- =============================================================================
-- 6. EVIDENCIA DE ENTREGA
-- =============================================================================

-- --- evidencias_entrega --------------------------------------------------------
create table if not exists evidencias_entrega (
  id                              uuid primary key default gen_random_uuid(),
  orden_trabajo_id                text not null unique,
  ruta_id                         uuid references rutas(id) on delete set null,
  conductor_id                    uuid references conductores(id) on delete set null,
  vehiculo_id                     uuid references vehiculos(id) on delete set null,
  resultado                       text not null,
  litros_entregados               numeric,
  receptor_nombre                 text,
  receptor_documento              text,
  comentario                      text,
  motivo_incidencia                text,
  posicion_capturada              jsonb,
  precision_captura_metros        numeric,
  distancia_a_cliente_metros      numeric,
  declarado_at                    timestamptz not null,
  recibido_at                     timestamptz not null default now(),
  enviado_offline                 boolean not null default false,

  constraint evidencias_entrega_resultado_valido check (resultado in ('entregada', 'incidencia')),
  constraint evidencias_entrega_motivo_valido
    check (motivo_incidencia is null or motivo_incidencia in (
      'cliente_ausente', 'sin_acceso', 'estanque_lleno', 'rechazo_cliente',
      'documentacion', 'problema_vehiculo', 'condiciones_seguridad',
      'direccion_incorrecta', 'otro'
    ))
);
comment on table evidencias_entrega is 'Evidencia de entrega levantada en terreno por el conductor. Unica por orden de trabajo (idempotente).';
comment on column evidencias_entrega.orden_trabajo_id is 'Referencia opaca a la OT en el ERP de Fenice. Sin llave foranea.';

create index if not exists idx_evidencias_entrega_ruta on evidencias_entrega(ruta_id);

alter table evidencias_entrega enable row level security;


-- --- fotos_evidencia -----------------------------------------------------------
create table if not exists fotos_evidencia (
  id             uuid primary key default gen_random_uuid(),
  evidencia_id   uuid not null references evidencias_entrega(id) on delete cascade,
  imagen         bytea not null,
  tipo_mime      text not null,
  ancho          integer not null,
  alto           integer not null,
  peso_bytes     integer not null,
  capturada_at   timestamptz not null default now(),

  constraint fotos_evidencia_tipo_valido check (tipo_mime in ('image/jpeg', 'image/png', 'image/webp'))
);
comment on table fotos_evidencia is 'Fotografias de evidencia, como binario (bytea) — no como texto base64.';

create index if not exists idx_fotos_evidencia_evidencia on fotos_evidencia(evidencia_id);

alter table fotos_evidencia enable row level security;


-- =============================================================================
-- 7. PORTAL DEL CONDUCTOR
-- =============================================================================

-- --- enlaces_conductor -----------------------------------------------------
-- El enlace en si (firmado con HMAC, ver src/services/drivers/route-token.ts)
-- nunca se guarda: solo el hash de su token, para poder revocarlo. La firma
-- es lo que hace al enlace valido; esta tabla es SOLO el registro de
-- revocacion y auditoria, compartido entre instancias.
create table if not exists enlaces_conductor (
  id                uuid primary key default gen_random_uuid(),
  ruta_id           uuid not null references rutas(id) on delete cascade,
  token_hash        text not null unique,
  emitido_at        timestamptz not null default now(),
  expira_at         timestamptz not null,
  revocado_at       timestamptz,
  revocado_motivo   text,
  emitido_por       uuid references usuarios(id) on delete set null,
  ip_emision        inet
);
comment on table enlaces_conductor is 'Registro de emision y revocacion de enlaces del portal del conductor.';

create index if not exists idx_enlaces_conductor_ruta on enlaces_conductor(ruta_id);

alter table enlaces_conductor enable row level security;
