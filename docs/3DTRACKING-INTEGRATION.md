# Integración con 3DTracking

La plataforma admite 3DTracking Client WebApi y Partner WebApi v1.0. El primer FMC130 se instalará en RBDC59. Para la preparación del equipo y la aceptación en terreno, seguir [la guía del piloto](FMC130-PRUEBAS-RBDC59.md).

## Configuración del servidor

```dotenv
GPS_PROVIDER=3dtracking
TRIDTRACKING_BASE_URL=https://apiv2.3dtracking.net
TRIDTRACKING_API_MODE=client
TRIDTRACKING_COMPANY_UID=
TRIDTRACKING_USERNAME=<usuario API>
TRIDTRACKING_PASSWORD=<clave API>
TRIDTRACKING_TIMEOUT_MS=15000
GPS_LIVE_TRANSPORT=polling
GPS_REFRESH_INTERVAL_MS=15000
GPS_HISTORY_DIR=.fenice/gps-history
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false
```

Las credenciales permanecen en el servidor. El navegador consulta `/api/gps/*` de Fleet Control. Los mensajes de error censuran las credenciales y las peticiones no siguen redirecciones hacia otro servidor.

## Movilmaster y Partner API

El portal de Movilmaster `https://3dt.mcitelecom.com/live/` es el acceso web del proveedor. Una sesión abierta allí no demuestra que el mismo usuario pueda autenticarse en la API. Si la autenticación responde `50017` / `User Could not be Authenticated`, confirmar con MCI Telecom el usuario exacto, la habilitación de API y el endpoint aplicable; no repetir autenticaciones indefinidamente ni cambiar contraseñas para resolverlo.

La documentación entregada de Partner API publica su esquema en [el recurso de definición oficial](https://partnerapi.3dtracking.net/api/v1.0/) y su interfaz en [Swagger](https://partnerapi.3dtracking.net/swagger/ui/index#/). Para ese contrato, usar:

```dotenv
TRIDTRACKING_BASE_URL=https://partnerapi.3dtracking.net
TRIDTRACKING_API_MODE=partner
TRIDTRACKING_COMPANY_UID=<UID de la empresa a consultar>
TRIDTRACKING_USERNAME=<usuario habilitado para API>
TRIDTRACKING_PASSWORD=<clave de ese usuario>
```

`CompanyUid` limita el catálogo y `CompanyUids` limita posiciones actuales. Si la cuenta es de un partner con varios clientes, seleccionar la empresa de Fenice antes de publicar sus unidades. Los namespaces del archivo GPS separan modo, servidor, cuenta y empresa. La clave y los datos privados de puesta en marcha no se versionan.

| Uso en Partner API | Endpoint y diferencia |
|---|---|
| Autenticación | POST `/api/v1.0/Authentication/UserAuthenticate`, parámetros `UserName` y `Password` |
| Catálogo | GET `/api/v1.0/Units/List`; el catálogo usa `IMEI` en mayúsculas |
| Posiciones | GET `/api/v1.0/Units/LatestPositionsList` |
| Historial | GET `/api/v1.0/Data/PositionsList`; hasta 500 posiciones por página, paginación con `StartId` |
| Alertas | Ese contrato no publica un endpoint de alertas; no se consulta la ruta de Client API |

Partner API empieza 24 horas atrás con cursor inicial vacío o hasta 7 días atrás con `StartId=0`. No devuelve `IsCurrent`: la lectura continúa hasta una página vacía, usando el cursor devuelto y rechazando páginas no vacías con cursor detenido. No se supone que una página corta sea la última. Para fechas anteriores se necesita el archivo GPS conservado por la aplicación. Posiciones, fechas, velocidad, ignición y continuidad usan las mismas validaciones del modo Client.

## Contrato oficial de respuestas

Los endpoints responden con `{ Status, Result }`. El cliente comprueba errores de `Status` incluso con HTTP 200 y entrega el contenido de `Result` al proveedor. El formato esperado procede del [OpenAPI oficial](https://apiv2.3dtracking.net/openapi/v1.json).

| Uso | Endpoint | Contenido de Result |
|---|---|---|
| Autenticación | `/api/v1.0/authentication/userauthenticate` | UserIdGuid y SessionId |
| Flota | `/api/v1.0/units/unit/list` | Lista de Unit |
| Posiciones actuales | `/api/v1.0/units/latestpositionslist` | Lista de UnitLatestPosition con Position |
| Historial | `/api/v1.0/data/positionslist` | Position, StartId e IsCurrent |
| Alertas | `/api/v1.0/alerts/alerts/list` | AlertList y StartUID |

La sesión se reutiliza y se renueva preventivamente cada 30 minutos. Las llamadas concurrentes comparten autenticación; una sesión expirada permite un solo reintento. Los errores de red o HTTP 500 no abren sesiones nuevas automáticamente. El diagnóstico reutiliza la sesión vigente.

## Posiciones y salud GPS

Las lecturas concurrentes de posición y estado comparten una instantánea durante dos segundos. La suscripción consulta instantáneas completas cada `GPS_REFRESH_INTERVAL_MS`; al cerrarla no entrega resultados de solicitudes pendientes.

No se usa `LastDateReceivedUtc` en este piloto. El contrato permite ese filtro, pero requiere una fecha de recepción con formato específico; usar el instante del fix como cursor podía omitir registros reenviados tras un corte. Las instantáneas completas evitan ese error.

`tridtracking-mapper.ts` normaliza velocidad a km/h, rumbo, ignición y fechas UTC. Un fix nulo, fuera de rango o cercano a `(0,0)` queda marcado inválido y no se dibuja. La salud del equipo prefiere `Position.GPSTimeUtc` a `LastReportedTimeUTC`: recibir hoy un fix de ayer no demuestra ubicación actual.

El IMEI enlaza el UID de 3DTracking con el id local de un camión cuando ya existe en la flota propia. Posiciones, estados, eventos e historial conservan esa identidad local; las peticiones de historial usan el UID externo. Los camiones que solo existen en 3DTracking aparecen con sus datos disponibles, sin inventar capacidad, compartimentos ni planta.

## Recuperación del historial

La primera solicitud usa `Uid` y `StartHourUtc`, redondeado hacia abajo a la hora UTC inicial. Las siguientes usan el `StartId` devuelto por la respuesta, sin calcularlo por cantidad de filas. Cada elemento de `Result.Position` contiene `Unit`, que identifica el camión.

La paginación continúa hasta `IsCurrent=true`, con un máximo de 20 páginas. Si el cursor no avanza, el formato es incompatible o se alcanza el máximo, se informa un error en lugar de entregar silenciosamente un recorrido incompleto. Se filtran el camión y las fechas y se conservan los extremos al reducir el número de muestras.

El archivo local combina las posiciones del proveedor con las ya conservadas. Ejecutar `npm run gps:record` como proceso supervisado y usar un volumen persistente con respaldo. La clave del archivo distingue proveedor, servidor API y cuenta; cambiar de cuenta requiere conservar o migrar el archivo correspondiente.

## Alertas

`AlertList` usa `AlertUID`, `AlertName`, `AlertType`, `Vehicle`, `CreatedDate` y `AlertMessage`. El nombre o UID de `Vehicle` se enlaza únicamente cuando identifica una sola unidad. Las alertas desconocidas se descartan; no se convierten en recuperaciones de señal. Los eventos disponibles dependen de los permisos y reglas configurados en 3DTracking.

## Comprobaciones de puesta en marcha

```bash
npm run gps:test
npm run gps:check -- --plate RBDC59
npm run gps:check -- --plate RBDC59 --imei <IMEI_REAL> --history
```

En Configuración se puede probar 3DTracking por patente y verificar opcionalmente IMEI y recorrido. El endpoint interno `POST /api/gps/3dtracking/probar-conexion` es de solo lectura, exige permiso de flota y comprueba origen de la solicitud.

`GET /api/system/gps` distingue una sesión válida de una consulta fallida de flota o posiciones. Tener una sesión no basta para demostrar que el camión transmite. Sin credenciales se muestra sin conexión y no se activa un simulador.

La validación de software usa respuestas de prueba con el formato oficial. La validación en terreno debe repetir posición, ignición, detenciones, pérdida de señal, reconexión y recorrido con el FMC130 real.

Referencia: [documentación oficial v1](https://apiv2.3dtracking.net/docs/v1/).


## Comprobación de accesos del 8 de octubre de 2026

La autenticación visible en Partner API devuelve `ok`. El conector de Fleet Control confirmó el acceso con esas credenciales y las consultas de unidades, posiciones e historial. La configuración local usa `https://partnerapi.3dtracking.net`, modo `partner` y el `CompanyUid` de la cuenta Zyteron SpA, con demostración desactivada. Las credenciales permanecen en `.env.local`, fuera de Git; el servidor local se reinició para aplicar la configuración.

El catálogo devuelve una unidad identificada por su IMEI, sin posición actual ni muestras de recorrido de la última hora. Todavía no aparece una unidad con nombre RBDC59. La prueba por patente confirma que el servidor responde y que falta identificar el equipo del primer camión y comprobar su transmisión real. No se asigna el único equipo a RBDC59 sin confirmar que corresponde a ese vehículo.

La cuenta permite consultar unidades, posiciones e historial, pero rechaza los listados administrativos de empresas y trackers por permisos. Estos listados no son necesarios para leer la telemetría del equipo ya registrado. El `CompanyUid` se obtuvo del catálogo de unidades, sin ampliar permisos.

El proveedor también devolvió `Too Many Requests. Rate limit reached.` durante la comprobación web. El cliente HTTP respeta `Retry-After` cuando está presente y, en su ausencia, pausa las peticiones durante 60 segundos, aumentando la espera hasta 5 minutos si el límite se repite. La pausa también evita nuevas autenticaciones y consultas de diagnóstico. Las posiciones se comparten entre pantallas durante al menos 15 segundos y conservan la fecha original del GPS.

Pendientes para la instalación:

- Confirmar qué IMEI se instalará en RBDC59 y asociar la unidad a esa patente.
- Si el proveedor entrega el FMC130 configurado, comprobar recepción de una posición reciente e ignición y realizar un recorrido de prueba. Si lo configuramos nosotros, obtener host, puerto, protocolo y APN de la SIM.
- Configurar las mismas variables privadas en el entorno de despliegue cuando esté disponible. Esta validación corresponde al servidor local.
