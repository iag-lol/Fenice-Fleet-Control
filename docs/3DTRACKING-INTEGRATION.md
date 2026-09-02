# Integracion con 3DTracking

Telemetria GPS real desde **3DTracking Client WebApi v1.0**
(https://apiv2.3dtracking.net/docs/v1/).

---

## 1. Activar

```bash
GPS_PROVIDER=3dtracking
TRIDTRACKING_BASE_URL=https://apiv2.3dtracking.net
TRIDTRACKING_USERNAME=<usuario>
TRIDTRACKING_PASSWORD=<clave>
TRIDTRACKING_TIMEOUT_MS=15000
```

No hay que tocar ni una linea de codigo: toda la aplicacion consume la
interfaz `GpsProvider`, nunca una implementacion concreta.

### Comprobar que funciona

```bash
curl -s http://localhost:3000/api/system/gps | jq
```

```json
{
  "provider": "3dtracking",
  "credencialesPresentes": true,
  "ok": true,
  "message": "Sesion establecida con 3DTracking.",
  "latencyMs": 25,
  "vehiculos": 3,
  "posiciones": 3,
  "posicionesValidas": 2,
  "ultimaPosicionAt": "2026-09-02T13:58:12.089Z"
}
```

`posicionesValidas` menor que `posiciones` no es un fallo: significa que
algun equipo reporta **sin fijacion satelital**. Ver §4.

---

## 2. Seguridad: credenciales en la URL

Esta API pide `UserIdGuid` y `SessionId` como **parametros de consulta** en
cada llamada, no como cabeceras.

Consecuencias que gobiernan el diseño de la integracion:

- Todo el cliente es `server-only`. **Jamas** se importa desde un componente
  de navegador. Si llegara, las credenciales quedarian en el historial del
  usuario y en cualquier cabecera `Referer`.
- Toda URL que pueda acabar en un registro pasa por `redactUrl()`, que
  sustituye `SessionId`, `UserIdGuid`, `username` y `password` por `***`.
- El navegador nunca habla con 3DTracking: pide a `/api/gps/positions` de
  esta aplicacion, que es quien consulta al proveedor.

---

## 3. Sesion

`POST|GET /api/v1.0/authentication/userauthenticate?username=&password=`
devuelve `{ Status, Result: { UserIdGuid, SessionId } }`.

- La sesion se **cachea** y se renueva cada 30 minutos. La API no publica su
  vida util, asi que se renueva por precaucion antes de que caduque.
- Las llamadas concurrentes **comparten una unica autenticacion en curso**. Al
  arrancar, varias pantallas piden posiciones a la vez; abrir cinco sesiones
  simultaneas es la forma tipica de que un proveedor bloquee la cuenta.
- Ante un fallo se renueva la sesion y se reintenta **una sola vez**. Mas
  reintentos convertirian unas credenciales erroneas en un bucle de peticiones.

---

## 4. Traduccion de datos

Toda la logica delicada vive en `tridtracking-mapper.ts`, que es puro y se
prueba sin red ni credenciales.

| Problema | Como se resuelve | Por que importa |
|---|---|---|
| `SpeedMeasure` varia por cuenta (km/h, mph, nudos, m/s) | Se normaliza siempre a km/h | 62 mph leidos como 62 km/h dispararian solas las alertas de exceso de velocidad |
| Fechas UTC **sin sufijo de zona** | Se les añade `Z` antes de interpretarlas | En Chile se leerian con 3-4 h de desfase: el sistema creeria que toda la flota lleva horas sin reportar |
| `Ignition` es texto libre, no booleano | `on` / `off` / `unknown` | Suponer "apagado" inventaria detenciones que nadie observo |
| Coordenada `(0,0)` | `valid: false`, y el mapa **no la dibuja** | El (0,0) es el Golfo de Guinea: pondria camiones chilenos en el Atlantico |
| `Heading` fuera de rango | Se normaliza a 0-359 | |
| Unidad sin nombre | Cae al IMEI | El camion sigue siendo identificable en pantalla |

Un vehiculo sin fijacion **sigue apareciendo en los listados** con su estado
de conexion. Solo se omite del mapa: "reporta pero sin GPS" no es lo mismo
que "no reporta", y esa diferencia se explica en la ficha, no en el mapa.

### Lo que el GPS NO sabe

Capacidad del estanque, compartimentos, planta y patente formal son datos del
ERP de Fenice. Se dejan **vacios**, nunca supuestos: inventar litros llevaria
a planificar cargas imposibles.

---

## 5. Union del parque

`mergeFleet()` combina el parque del ERP con el que conoce la telemetria:

- El **ERP manda** cuando el vehiculo esta en ambos.
- Un camion que reporta y **no** figura en el ERP se muestra igual, porque
  existe y esta circulando.
- El **IMEI** une ambos mundos cuando cada sistema usa su propio codigo.

Sin esto, conectar el GPS antes que la base de Fenice dejaba el mapa vacio:
llegaban posiciones de vehiculos que ningun listado incluia.

---

## 6. Tiempo real

La API **no ofrece websocket ni streaming**. La suscripcion se resuelve por
sondeo cada `GPS_REFRESH_INTERVAL_MS`.

Se aprovecha `LastDateReceivedUtc` de `latestpositionslist`, que devuelve solo
lo reportado despues de esa marca: el trafico queda proporcional a lo que de
verdad cambia. La marca avanza con la posicion **recibida** mas reciente, no
con el reloj local — si el servidor va desfasado, usar la hora local dejaria
fuera posiciones legitimas.

Como el transporte es sondeo, conviene `GPS_LIVE_TRANSPORT=polling`.

---

## 7. Endpoints usados

| Uso | Endpoint |
|---|---|
| Autenticacion | `/api/v1.0/authentication/userauthenticate` |
| Parque | `/api/v1.0/units/unit/list` |
| Posiciones actuales | `/api/v1.0/units/latestpositionslist` |
| Historial | `/api/v1.0/data/positionslist` |
| Alertas | `/api/v1.0/alerts/alerts/list` |

El historial avanza por `StartId` (cursor incremental), **no** por rango de
fechas: se pagina hacia adelante y se recorta por fecha, con un tope de 20
paginas para que una ventana amplia no descargue meses de historia.

---

## 8. Si algo falla

Un proveedor mal configurado **no tumba la aplicacion** y **no degrada al
simulador**. Se usa `UnavailableGpsProvider`: devuelve vacio y explica el
motivo en `/api/system/gps`.

Degradar al simulador seria mucho peor que un mapa vacio: la operacion veria
camiones inventados moviendose y los tomaria por reales.

---

## 9. Al terminar la prueba

La API es temporal. Para desconectarla:

```bash
GPS_PROVIDER=mock          # o dejar 3dtracking sin credenciales
TRIDTRACKING_USERNAME=
TRIDTRACKING_PASSWORD=
```

Nada mas cambia. Conviene ademas rotar la clave en 3DTracking, porque estuvo
en las variables de entorno del despliegue.
