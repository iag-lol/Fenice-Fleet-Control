# Pendientes de Supabase para Fenice

## Estado verificado el 9 de octubre de 2026

La revisión remota confirmó las 18 tablas internas con RLS y permisos de servidor, el bucket privado de publicidad con los MIME requeridos, la restricción GPS compatible y el límite de velocidad. Render está conectado al proyecto **Fleet Control Fenice** con una clave de servidor válida. No hace falta volver a ejecutar la instalación completa.

Se aplicaron las migraciones `gps_fleet_unknown_details_and_unique_links` y `gps_vehicle_type_unknown`, incluidas en `supabase/migrations`. Permiten registrar una unidad antes de conocer su ficha técnica (capacidad y compartimentos en 0, año nulo, tipo `sin_dato`) e impiden asociar el mismo GPS a dos vehículos. No modifican las fichas existentes. RBDC59 y el FMC130 confirmado ya quedaron registrados y vinculados mediante IMEI y UID externo, sin inventar características del camión.

Las credenciales GPS se configuraron en Render, con demostración apagada y acceso administrativo protegido. La comprobación final detectó que Render apuntaba al proyecto Supabase anterior: se corrigieron la URL y la clave de servidor para usar **Fleet Control Fenice**, el mismo proyecto donde está registrada la flota. La revisión local utiliza ese mismo proyecto. Se verificó un administrador activo con contraseña en formato bcrypt; no se creó ni reemplazó su contraseña durante esta revisión.

El archivo propio de recorridos aún requiere un volumen persistente y un grabador supervisado en producción. Render no tiene disco adjunto. Se preparó la opción de 1 GB en la carpeta `.fenice` (US$0,25/mes), pendiente de autorización de contratación. El catálogo y la última posición continúan consultándose desde la API GPS; no son posiciones almacenadas en Supabase.

Para los próximos ocho equipos, registrar sus patentes e IMEI confirmados y vincular cada uno a un vehículo. El conector descubre nuevas unidades del catálogo al renovarlo; las pruebas existentes cubren nueve unidades simultáneas sin mezclar posiciones, estados ni historiales. No registrar unidades de ejemplo en producción.

## Instalación o recuperación del esquema

El archivo [supabase/schema.sql](../supabase/schema.sql) reúne la instalación y las actualizaciones que requiere la versión actual de Fleet Control. Se puede aplicar a un proyecto nuevo o volver a ejecutar sobre el esquema anterior de este repositorio. Crea las tablas faltantes, conserva las filas existentes y actualiza los campos conocidos de compatibilidad. El proyecto remoto todavía necesita sus credenciales en el servidor.

## Ejecutar el SQL

1. Abre el proyecto correcto de Supabase y entra a **SQL Editor**.
2. Copia el archivo `supabase/schema.sql` completo en una consulta nueva y ejecútalo.
3. Revisa las comprobaciones que aparecen al final de la ejecución.

El archivo realiza la instalación en una transacción. No inserta flota de ejemplo, usuarios, contraseñas, pedidos, dispositivos ni IMEI. Ajusta los permisos únicamente de las tablas de Fenice y los metadatos de su bucket de publicidad. Si otra aplicación usa esas mismas tablas directamente con los roles `anon` o `authenticated`, sus accesos quedarían restringidos: Fleet Control accede mediante su servidor.

| Componente | Resultado del SQL |
|---|---|
| Base interna | 18 tablas para login, auditoría, flota, rutas, geocercas, alertas, configuración, evidencia y enlaces del conductor |
| FMC130 y 3DTracking | Columnas `proveedor`, `servidor_url`, `habilitado`, `ultima_conexion_at`; actualiza la restricción antigua que solo permitía Traccar |
| Límites de velocidad | Columna `ruta_velocidad_maxima_legal_kmh`, con 60 km/h como valor inicial si no existía; conserva el valor de una columna ya configurada |
| Permisos | RLS en las 18 tablas, acceso de lectura/escritura para `service_role` y sin acceso directo de los roles públicos a esas tablas |
| Publicidad | Bucket **privado** `fenice-tracking-content`, límite 2 MB, tipos JPG, PNG, WebP y JSON; conserva sus archivos |
| API | Notificación de recarga del esquema y consultas de comprobación |

La publicidad usa Storage, no una tabla nueva de clientes o pedidos. `application/json` es necesario porque la configuración del carrusel se guarda como `content.json`. La creación de buckets por SQL y sus límites están documentados en [Supabase Storage](https://supabase.com/docs/guides/storage/buckets/creating-buckets). Los permisos explícitos complementan RLS según [la documentación de la Data API](https://supabase.com/docs/guides/api/securing-your-api).

## Conectar el servidor

Configura estos valores en `.env.local` para desarrollo o en las variables del servidor de producción:

```dotenv
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=TU-CLAVE-SECRETA-DEL-SERVIDOR
```

Usa la clave secreta de servidor (`service_role` legado o la clave secreta vigente del proyecto), no la clave pública. Conserva los valores existentes si ya funcionan. La clave no lleva prefijo `NEXT_PUBLIC_` y no se pega en el navegador, en capturas, en Git ni en el chat.

Crea el primer administrador, si aún no existe:

```bash
npm run create:admin
```

El comando solicita RUT, nombre y contraseña. Si ya hay administradores, no necesitas volver a crearlos. Después activa `AUTH_ENABLED=true` y reinicia o redespliega el servidor. El seguimiento del cliente mantiene su entrada pública; la administración exige sesión y el permiso de configuración.

Si se utilizan enlaces del portal del conductor, configura también `DRIVER_PORTAL_SECRET` con un secreto estable de al menos 16 caracteres, conservando el existente. Los enlaces deben usar el mismo secreto entre reinicios e instancias.

## Comprobar la conexión

Al finalizar el SQL, las consultas deben mostrar:

- Las **18 tablas**, con `rls_activo`, `servidor_puede_leer` y `servidor_puede_insertar` en `true`.
- `anon_puede_leer` y `auth_puede_leer` en `false` para esas tablas internas.
- El bucket `fenice-tracking-content`, con `public=false`, `file_size_limit=2097152` y `application/json` entre los MIME permitidos.
- La restricción GPS aceptando `traccar` y `3dtracking`.

Después, abre `/api/system/supabase`: debe informar conexión correcta. Inicia sesión y guarda una campaña en **Configuración → Publicidad del seguimiento**. Recarga para confirmar su permanencia, sube una imagen y abre un seguimiento para comprobar su lectura. No crees políticas públicas de escritura en Storage: la aplicación ya sube los archivos desde el servidor autorizado.

## Pendientes que requieren configuración o procesos

El SQL deja preparada la base, pero estas tareas pertenecen a servicios o datos reales:

- **RBDC59:** ya registrado y vinculado al FMC130 confirmado. Completar marca, modelo, año, tipo, capacidad y compartimentos cuando se conozcan.
- **GPS real:** credenciales de consulta configuradas en Render. En terreno, confirmar alimentación, SIM/APN y transmisión reciente. Supabase no recibe directamente el protocolo del FMC130.
- **Clientes y OT:** conectar el ERP de Fenice en modo de solo lectura. Esos datos no se trasladan a las tablas internas de Supabase mediante este script.
- **Historial GPS:** definir `GPS_HISTORY_DIR` en un volumen persistente y ejecutar `npm run gps:record` bajo un proceso que se reinicie al fallar. La publicidad guardada en Storage no implica que el archivo de posiciones GPS también esté en Supabase.
- **Alertas reales:** desplegar el proceso que evalúa los motores operacionales e inserta alertas de la flota real. Las tablas ya existen; un SQL de instalación no reemplaza ese proceso.

## Validación del paquete

El SQL se ejecutó en PostgreSQL local mediante PGlite con la extensión `pgcrypto`. Se comprobó instalación nueva, segunda ejecución, conservación de filas y configuración, permisos, RLS, triggers, aceptación de 3DTracking y actualización de columnas/restricción antiguas. Los metadatos de Storage y los roles de Supabase se representaron en ese entorno de prueba. La operación remota de Storage y la comprobación en el proyecto real requieren la conexión indicada arriba.

## Seguridad - 9 de octubre de 2026

Aplicadas las migraciones `20261009071558_security_atomic_login_and_default_privileges.sql` y `20261009072730_security_login_ip_cast.sql`: bloqueo de login atómico, control de éxito contra la versión actual de la contraseña, funciones privadas y permisos por defecto restringidos. No hay SQL pendiente de estas correcciones. Ver [operación de seguridad](SEGURIDAD.md) para claves de cifrado y enlaces compartidos.
