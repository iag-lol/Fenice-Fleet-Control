# Integración GPS — Conectar Traccar

Cómo pasar del simulador integrado a la telemetría real de los equipos
Teltonika instalados en la flota de Fenice.

**Estado actual:** `GPS_PROVIDER=mock`. El código del proveedor Traccar está
completo y compila, pero **no ha sido ejecutado contra un servidor real**
porque todavía no existe la instancia de Fenice. Lo que sigue describe cómo
activarlo y qué verificar al hacerlo.

---

## 1. La cadena completa

```
Teltonika FMC130  →  SIM 4G  →  Servidor Traccar  →  Fenice Fleet Control
   (vehículo)       (red móvil)   (tu servidor)         (esta plataforma)
```

El equipo transmite por protocolo Teltonika a un puerto TCP del servidor
Traccar. Traccar almacena las posiciones y las expone por API REST y
WebSocket. Esta plataforma **nunca habla directamente con el equipo GPS**: solo
consume la API de Traccar, y siempre desde el servidor.

---

## 2. Variables de entorno necesarias

En `.env.local`:

```bash
GPS_PROVIDER=traccar

TRACCAR_BASE_URL=https://gps.fenice.cl
TRACCAR_TOKEN=<token-de-api>
TRACCAR_WEBSOCKET_URL=wss://gps.fenice.cl/api/socket

# Alternativa al token (menos recomendable):
# TRACCAR_USERNAME=integracion@fenice.cl
# TRACCAR_PASSWORD=<contraseña>
```

**Sobre el token:** créalo en Traccar desde *Configuración → Usuario → Token*.
Es preferible a usuario/contraseña por dos razones: es revocable sin cambiar
credenciales de persona, y **es la única forma de autenticar el WebSocket**
(la API estándar de WebSocket del navegador y de Node no permite enviar
cabeceras de autorización, y Traccar acepta el token por *query string*).

Sin `TRACCAR_TOKEN`, la suscripción en vivo degrada automáticamente a consulta
periódica. Funciona igual, solo consume algo más de red.

**Estas credenciales no llegan nunca al navegador.** Se leen en
`src/config/env.ts`, que es un módulo de servidor, y se usan solo dentro de
`TraccarGpsProvider`.

---

## 3. Endpoint backend (el proxy)

El navegador **no habla con Traccar**. Habla con estos endpoints de la
plataforma, que actúan como proxy:

| Endpoint | Propósito |
|---|---|
| `GET /api/gps/positions` | Última posición de toda la flota + instantánea de estado |
| `GET /api/gps/stream` | Stream SSE de posiciones en vivo |
| `GET /api/gps/history/[vehicleId]` | Historial en una ventana temporal |
| `GET /api/system/mode` | Proveedor activo (alimenta el indicador `GPS: DEMO` / `GPS: CONECTADO`) |

Esto no es un detalle de implementación: es la frontera de seguridad. Si el
navegador pudiera llamar a Traccar directamente, el token estaría en el bundle
de JavaScript y sería público.

**No hay que tocar nada de esto al activar Traccar.** Los endpoints ya
consumen la interfaz `GpsProvider`; cambia la implementación por debajo.

---

## 4. WebSocket y degradación

`TraccarGpsProvider.subscribeToPositions()` intenta, en orden:

1. **WebSocket** a `TRACCAR_WEBSOCKET_URL` con el token en la query string.
   Traccar publica en `/api/socket` un mensaje con `{positions, devices, events}`.
2. **Consulta periódica** a `/api/positions` cada `GPS_REFRESH_INTERVAL_MS`,
   si el socket no está configurado, falla al abrir o se cierra.

La degradación es automática y **silenciosa para el consumidor**. El único
efecto visible es el indicador de transporte en el encabezado.

Del lado del navegador ocurre lo mismo con SSE: `HttpGpsProvider` intenta
`/api/gps/stream` y cae a consulta periódica sobre `/api/gps/positions` si el
navegador o un proxy intermedio no soportan SSE.

---

## 5. Mapeo dispositivo → vehículo

Este es el punto que **requiere una decisión de Fenice**.

Traccar identifica equipos por un `id` numérico interno y un `uniqueId` (que
para Teltonika es el IMEI). La plataforma identifica vehículos por su propio
`VehicleId`. El enlace vive en `GpsDevice`:

```ts
interface GpsDevice {
  id: DeviceId;
  imei: string;        // ← coincide con uniqueId de Traccar
  externalId?: string; // ← coincide con id numérico de Traccar
  // ...
}
```

`TraccarGpsProvider.getLinks()` resuelve la correspondencia:

1. Primero por `externalId` contra el `id` de Traccar.
2. Si falta, por `imei` contra el `uniqueId` de Traccar.

**Qué hay que hacer:** cargar el maestro de equipos con el IMEI real de cada
FMC130 instalado y la patente del vehículo en que va montado. Mientras la
fuente operacional sea el dataset de demostración, esa correspondencia sale de
`src/data/dataset.ts`. Cuando se conecte la base de Fenice, saldrá de ahí.

Un dispositivo de Traccar que no encuentre vehículo se ignora silenciosamente:
es preferible a inventar un vehículo fantasma en el mapa.

---

## 6. Actualización de posiciones

`mapTraccarPosition()` (en `src/services/gps/traccar/traccar-mapper.ts`)
traduce cada posición. Puntos que conviene revisar al conectar:

| Campo Traccar | Campo interno | Nota |
|---|---|---|
| `fixTime` | `timestamp` | Instante del fix GPS. Se prefiere a `deviceTime`, que difiere cuando el equipo almacena y reenvía tras una zona sin cobertura |
| `serverTime` | `receivedAt` | Permite medir latencia real de la cadena |
| `speed` | `speed` | **Traccar reporta en nudos.** Se convierte a km/h (× 1.852) |
| `course` | `heading` | Se normaliza a 0–359 |
| `attributes.ignition` | `ignition` | Booleano del FMC130 |
| `attributes.totalDistance` | `odometerKm` | **En metros.** Se convierte a km |
| `attributes.batteryLevel` | `batteryLevel` | Se acota a 0–100 |

`normalizePosition()` descarta posiciones inutilizables antes de que lleguen al
mapa: coordenadas fuera de rango, el marcador `(0,0)` de fix no resuelto y
marcas de tiempo inválidas. Esto evita el problema clásico de camiones
apareciendo frente a la costa de África.

**Cadencia esperada:** una posición cada 15–30 s por vehículo. El mapa
interpola el movimiento entre reportes para que el marcador se desplace de
forma continua en vez de saltar.

---

## 7. Eventos

`mapTraccarEvent()` traduce solo los eventos que la operación de Fenice usa:

```
deviceOnline / deviceOffline / ignitionOn / ignitionOff
geofenceEnter / geofenceExit / deviceOverspeed
hardBraking / hardAcceleration / deviceMoving / deviceStopped
alarm / powerCut
```

Traccar emite bastantes más. Los tipos no mapeados **se descartan
deliberadamente**: propagarlos llenaría el centro de alertas de ruido y lo
volvería inútil.

**Nota sobre geocercas:** las geocercas de entrega las evalúa esta plataforma
(`GeofenceEngine`), no Traccar. Son dos motores independientes y no hace falta
replicar las geocercas en Traccar. Si Fenice prefiere que Traccar las gestione,
los eventos `geofenceEnter` / `geofenceExit` ya llegan mapeados y el
`GeofenceEngine` puede desactivarse.

---

## 8. Cambio de `mock` a `traccar`, paso a paso

```bash
# 1. Confirmar que el servidor Traccar responde y el token es válido
curl -H "Authorization: Bearer $TRACCAR_TOKEN" https://gps.fenice.cl/api/devices

# 2. Configurar .env.local
GPS_PROVIDER=traccar
TRACCAR_BASE_URL=https://gps.fenice.cl
TRACCAR_TOKEN=...
TRACCAR_WEBSOCKET_URL=wss://gps.fenice.cl/api/socket

# 3. Reiniciar el servidor
npm run build && npm start
```

### Verificación

1. **Indicador de modo:** el encabezado debe pasar de `GPS: DEMO` (ámbar) a
   `GPS: CONECTADO` (verde). El botón de pausar simulación desaparece.
2. **`GET /api/system/mode`** debe devolver `"provider": "traccar"`,
   `"simulated": false`.
3. **`GET /api/gps/positions`** debe devolver una posición por cada equipo
   enlazado. Si devuelve un array vacío con dispositivos existentes en
   Traccar, el problema es el **mapeo dispositivo → vehículo** (sección 5).
4. **Mapa operacional:** los camiones aparecen y se mueven. El contador
   `Última actualización hace N s` debe mantenerse por debajo de 60 s.
5. **Detalle de vehículo:** el historial debe poblarse. Si sale vacío,
   revisar que Traccar tenga retención de posiciones configurada.

### Qué esperar que falle primero

- **Enlace de dispositivos vacío.** Es el fallo más probable: los IMEI del
  maestro no coinciden con los `uniqueId` de Traccar. Se resuelve cargando los
  IMEI reales.
- **Velocidades diez veces menores de lo esperado.** Significa que la
  conversión de nudos se aplicó dos veces, o que la instalación de Traccar ya
  entrega km/h. Verificar contra un vehículo en movimiento conocido.
- **WebSocket que no abre.** Sin `TRACCAR_TOKEN` no puede autenticarse.
  Comprobar el transporte real en el tooltip del indicador del encabezado: si
  dice "Consulta periódica", el socket no conectó.

---

## 9. Volver al modo demostración

```bash
GPS_PROVIDER=mock
```

Nada más. El simulador vuelve a arrancar con su propio historial. Es útil para
demostrar la plataforma sin depender de conectividad ni de que haya camiones
circulando.
