# Integración con 3DTracking

La flota usa 3DTracking Client WebApi v1.0. El primer FMC130 se instalará en RBDC59. Para la preparación del equipo y la aceptación en terreno, seguir [la guía del piloto](FMC130-PRUEBAS-RBDC59.md).

## Configuración del servidor

```dotenv
GPS_PROVIDER=3dtracking
TRIDTRACKING_BASE_URL=https://apiv2.3dtracking.net
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
