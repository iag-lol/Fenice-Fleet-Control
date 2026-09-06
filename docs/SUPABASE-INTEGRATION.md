# Integración con Supabase

Cómo conectar la base interna de la plataforma (login, flota, rutas,
geocercas, alertas, configuración y evidencia de entrega) a un proyecto real
de Supabase.

**Estado actual:** todo lo descrito aquí está implementado y es aditivo. Sin
`SUPABASE_URL` configurado, la plataforma sigue funcionando exactamente igual
que antes: dataset de demostración en memoria, sin login. Configurar Supabase
no rompe nada; simplemente reemplaza la memoria del proceso por persistencia
real.

---

## 1. Qué vive en Supabase (y qué NO)

| Vive en Supabase | Sigue en la base externa de Fenice |
|---|---|
| Login: `usuarios`, `sesiones`, `intentos_login` | Clientes y sus direcciones |
| Auditoría de acciones administrativas | Pedidos y su detalle |
| Flota: vehículos, conductores, dispositivos GPS | Órdenes de trabajo (despachos) |
| Rutas y sus paradas planificadas | |
| Geocercas ("ubicaciones") y sus eventos | |
| Visitas de cliente detectadas por GPS | |
| Alertas operacionales | |
| Configuración operacional (`/configuracion`) | |
| Evidencia de entrega (fotos incluidas) | |
| Enlaces del portal del conductor (emisión/revocación) | |

Las tablas que referencian al ERP externo (`paradas_ruta`, `geocercas`,
`visitas_cliente`, `eventos_entrega`, `alertas`) lo hacen con columnas de
**texto libre** (`orden_trabajo_id`, `cliente_id`), nunca con llave foránea:
esas entidades no existen en esta base. Ver
[`EXTERNAL-DATABASE-INTEGRATION.md`](EXTERNAL-DATABASE-INTEGRATION.md) para
esa otra conexión, que no cambia con esto.

**Por qué NO Supabase Auth.** El login valida RUT y contraseña contra la
tabla `usuarios` desde el servidor, con la *service role key*. Esa clave se
salta Row Level Security por diseño de Supabase (equivale a un superusuario
de Postgres): la aplicación nunca delega la autenticación en el sistema de
usuarios de Supabase, ni el navegador habla con Supabase directamente. Es la
misma filosofía que ya usa el proyecto para Traccar, 3DTracking y el ERP:
credenciales que nunca salen del servidor, todo pasa por `/api/*`.

---

## 2. Puesta en marcha

### Paso 1 — Crear el proyecto

En [supabase.com](https://supabase.com), crea un proyecto nuevo (o usa uno
existente y vacío).

### Paso 2 — Ejecutar el esquema

Abre el **SQL Editor** del proyecto, pega el contenido completo de
[`supabase/schema.sql`](../supabase/schema.sql) y ejecútalo. Es idempotente:
se puede volver a correr sin duplicar tablas ni perder datos.

Crea 18 tablas (login, auditoría, flota, rutas, geocercas, alertas,
configuración, evidencia y enlaces del conductor), sus índices, restricciones
de validez (`check`) que reflejan los mismos valores permitidos que ya valida
la aplicación en TypeScript, y triggers para mantener `actualizado_at` al día.

Habilita Row Level Security en todas las tablas **sin ninguna política
permisiva**: es un cierre por defecto. La aplicación igual funciona porque
usa la service role key, que ignora RLS; esto solo protege ante una futura
exposición accidental de la anon key (que esta plataforma, hoy, ni siquiera
usa).

### Paso 3 — Variables de entorno

En **Settings → API** del proyecto, copia:

```bash
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # la "service_role", NUNCA la "anon"

AUTH_ENABLED=true

SESSION_TTL_HOURS=12
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCKOUT_MINUTES=15
```

**`SUPABASE_SERVICE_ROLE_KEY` es tan sensible como una contraseña de base de
datos.** Nunca debe llevar el prefijo `NEXT_PUBLIC_`, nunca debe pegarse en un
componente cliente, y en Vercel/Railway/donde sea que despliegues, se define
como variable de entorno del servidor, no como secreto de build público.

### Paso 4 — Crear el primer administrador

```bash
npm run create:admin
```

Pide RUT, nombre y contraseña de forma interactiva (la contraseña se
enmascara y nunca se muestra ni se guarda en texto plano: se hashea con
bcrypt antes de insertarla). También acepta argumentos para uso no
interactivo:

```bash
node scripts/create-admin-user.mjs --rut=12345678-9 --nombre="Ana Soto" --rol=administrador
```

Ejecutarlo de nuevo con el mismo RUT actualiza esa cuenta (útil para resetear
una contraseña olvidada) en vez de crear un duplicado.

### Paso 5 — Verificar

1. `npm run dev` y entra a cualquier URL de la aplicación: debe redirigir a
   `/login`.
2. Inicia sesión con el usuario creado.
3. Crea una geocerca desde `/configuracion/geocercas`, recarga la página:
   debe seguir ahí (persistida, no en memoria).
4. Cierra sesión y confirma que vuelve a pedir login.

---

## 3. Cargar flota y rutas reales

El esquema crea las tablas vacías. Para que `/flota` y `/rutas` muestren algo
real (no el dataset de demostración), hay que cargar:

1. **`dispositivos_gps`** — un registro por equipo GPS instalado (IMEI,
   modelo).
2. **`conductores`** — un registro por conductor.
3. **`vehiculos`** — un registro por camión, enlazando `dispositivo_id` y
   `conductor_id`.
4. **`rutas`** + **`paradas_ruta`** — la planificación del día. Cada parada
   lleva `orden_trabajo_id` y `cliente_id`: los números/IDs tal como los
   identifica el ERP de Fenice, para que el resto de la plataforma (evidencia
   de entrega, geocercas, seguimiento público) pueda cruzarlos.

Esto puede hacerse a mano desde el **Table Editor** de Supabase mientras se
prueba, o mediante un script/integración propia más adelante (por ejemplo, si
Fenice planifica sus rutas en una herramienta externa y quiere sincronizarlas
aquí). No existe hoy una pantalla de alta manual de flota/rutas en la
aplicación: las tablas y las lecturas ya están listas para eso, pero
construir esa pantalla es trabajo aparte, no incluido en esta entrega.

---

## 4. Lo que queda pendiente a propósito

**Generación automática de alertas.** Hoy, con Supabase configurado,
`GET /api/alertas` lee la tabla `alertas` tal cual — si nadie inserta filas,
viene vacía. En el modo de demostración (`OPERATIONS_PROVIDER=mock`), las
alertas se siguen calculando en cada petición evaluando los motores de reglas
(`src/lib/engines/*`) sobre el dataset simulado, sin cambios.

Para una operación real hace falta un proceso — un job periódico, o una
función que se dispare con cada posición GPS nueva — que evalúe esos mismos
motores contra la flota, las rutas y las geocercas reales, e inserte
(`upsert`, por id determinístico) filas en `alertas`. La tabla, los índices y
el endpoint de lectura/cambio de estado ya están listos para recibirlas; ese
proceso en sí es el siguiente paso, fuera de esta entrega.

**Content-Security-Policy.** No se agregó una CSP en `next.config.mjs`
porque el mapa carga tiles y estilos desde distintos dominios según
`NEXT_PUBLIC_MAP_PROVIDER` (OpenStreetMap, MapTiler, Mapbox, ArcGIS) y una
lista mal enumerada rompería el mapa sin avisar. Una vez fijado el proveedor
de mapa de producción, vale la pena añadir una CSP que enumere exactamente
esos dominios en `img-src`/`connect-src`/`style-src`.

---

## 5. Seguridad del login: resumen técnico

- **Contraseñas:** bcrypt, costo 12. Nunca viajan ni se registran en texto
  plano.
- **Enumeración de usuarios:** un RUT inexistente compara igual contra un
  hash señuelo, para que el tiempo de respuesta no delate si el RUT existe.
- **Sesiones:** token opaco de 32 bytes en una cookie `httpOnly`, `secure`
  (en producción) y `SameSite=Lax`. Solo se guarda su SHA-256 en la tabla
  `sesiones`: filtrar la base no expone sesiones utilizables.
- **Bloqueo por intentos:** `LOGIN_MAX_ATTEMPTS` fallos consecutivos bloquean
  la cuenta `LOGIN_LOCKOUT_MINUTES`. Además, `intentos_login` permite acotar
  por IP (independiente de la cuenta), para frenar quien prueba muchos RUT
  distintos desde la misma dirección.
- **CSRF:** además de `SameSite=Lax`, toda ruta que muta estado verifica que
  la cabecera `Origin`/`Referer` coincida con el propio sitio
  (`assertSameOrigin` en `src/lib/api.ts`).
- **Auditoría:** las acciones administrativas (crear/editar/eliminar
  geocercas, cambiar configuración, resolver alertas) quedan en la tabla
  `auditoria` con el usuario, la IP y el detalle del cambio.
