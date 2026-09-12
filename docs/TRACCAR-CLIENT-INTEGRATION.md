# Conectar GPS a un vehículo (Traccar Client / Teltonika)

Cómo hacer que un teléfono con **Traccar Client**, o un equipo GPS real
(Teltonika FMC130 y similares) que reporte a un servidor Traccar, aparezca en
tiempo real en el mapa de un vehículo concreto — sin tocar variables de
entorno ni afectar al resto de la flota.

Para conectar **toda la flota** de una sola vez a un único servidor Traccar
(`GPS_PROVIDER=traccar`), ver [`GPS-INTEGRATION.md`](./GPS-INTEGRATION.md).
Esta guía es el camino más simple: un dispositivo a la vez, desde la ficha del
vehículo.

---

## 1. Qué necesitas antes de empezar

1. Un servidor Traccar accesible por HTTPS (o HTTP en una red interna),
   propio o de terceros. **Esta plataforma no incluye ni instala un servidor
   Traccar**: solo se conecta a uno que ya exista.
2. Credenciales de acceso a ese servidor: un **token de API**, o un usuario y
   contraseña. Se configuran una sola vez, en el servidor de Fleet Control
   (variables `TRACCAR_TOKEN`, o `TRACCAR_USERNAME` + `TRACCAR_PASSWORD` —
   ver `.env.example`). **Nunca se ingresan en el navegador.**
3. Traccar Client instalado en el teléfono
   ([Android](https://www.traccar.org/client/),
   [iOS](https://apps.apple.com/app/traccar-client/id843156974)).

---

## 2. Configurar Traccar Client en el teléfono

1. Abre Traccar Client.
2. En **Device identifier**, escribe un identificador único para ese
   teléfono (ej. `demo-eduardo-01`). Puede ser cualquier texto: no necesita
   ser un IMEI real.
3. En **Server URL**, escribe la URL de tu servidor Traccar, por ejemplo:
   - `https://gps.midominio.cl`
   - `http://190.100.50.20:5055` (puerto del protocolo OsmAnd/Traccar Client)
4. Activa **Enable service** / el interruptor principal.

El teléfono empieza a enviar su posición al servidor. Traccar lo registra
como un **dispositivo nuevo** con ese `uniqueId` la primera vez que recibe una
posición suya — no hace falta "darlo de alta" manualmente en Traccar.

---

## 3. Conectar el vehículo en Fleet Control

1. Entra a **Flota** y abre el vehículo (o crea uno nuevo si todavía no
   existe: patente, código de flota, tipo, capacidad — los mínimos para dar
   de alta un camión).
2. En la ficha del vehículo, presiona **Conectar GPS**.
3. Completa:
   - **Identificador del dispositivo**: el mismo texto que pusiste en
     *Device identifier* dentro de Traccar Client.
   - **Servidor** (opcional): déjalo vacío para usar el servidor configurado
     por defecto (`TRACCAR_BASE_URL`); solo llénalo si este equipo en
     particular reporta a un servidor distinto.
4. Presiona **Probar conexión**. Fleet Control busca el dispositivo en
   Traccar por su identificador y confirma si ya tiene alguna posición:
   - ✅ Servidor conectado / ✅ Dispositivo encontrado / ✅ GPS transmitiendo
   - ❌ No se pudo conectar al servidor
   - ❌ Dispositivo no encontrado
   - ❌ Servidor conectado pero el dispositivo aún no reporta posición
5. Presiona **Guardar**. A partir de aquí, el vehículo se comporta como
   cualquier otro con GPS real: aparece en el mapa, se anima con cada
   posición nueva, y su estado (en línea / sin señal / offline) se calcula
   con los mismos umbrales que el resto de la flota.

No hace falta reiniciar el servidor ni cambiar `GPS_PROVIDER`: la asociación
vive en la base de datos de la plataforma (`dispositivos_gps` /
`vehiculos.dispositivo_id` en Supabase, o en memoria si Supabase no está
configurado) y se resuelve automáticamente en cuanto se guarda.

---

## 4. Verificar que está transmitiendo

- **Torre de control** (`/control`): el vehículo debe moverse en el mapa
  cuando el teléfono cambia de posición, sin recargar la página.
- **Ficha del vehículo**: velocidad, rumbo, última comunicación y estado GPS
  se actualizan solos.
- **Configuración → Integración GPS / Traccar**: permite repetir la prueba de
  conexión (servidor / dispositivo / posición) sin ir a un vehículo
  específico — útil para diagnosticar antes de asociar.
- Si Traccar Client se detiene o el teléfono pierde señal, el vehículo pasa a
  "sin señal" y luego a "offline" según los umbrales configurados en
  Configuración → Salud de la telemetría GPS (no se inventa una posición
  nueva ni se simula que sigue conectado).

---

## 5. Reemplazar el teléfono por un Teltonika FMC130

El teléfono es solo el dispositivo de prueba. Para pasar a hardware real:

1. Configura el Teltonika para reportar al mismo servidor Traccar (protocolo
   Teltonika Codec 8, puerto correspondiente — ver la documentación de
   Traccar para ese protocolo).
2. En la ficha del vehículo, abre **Conectar GPS** y reemplaza el
   identificador por el IMEI del equipo (Traccar usa el IMEI como `uniqueId`
   para los dispositivos Teltonika).
3. Prueba la conexión y guarda. No hace falta ningún otro cambio: la
   plataforma no distingue entre un teléfono y un Teltonika, ambos son
   "un dispositivo Traccar" desde su perspectiva.

---

## 6. Limitaciones de esta primera versión

- Todos los dispositivos vinculados desde "Conectar GPS" —sin importar el
  servidor que se les indique— se autentican con las **mismas** credenciales
  configuradas en `TRACCAR_TOKEN` / `TRACCAR_USERNAME` + `TRACCAR_PASSWORD`.
  Si vas a usar un servidor distinto al configurado por defecto, esa cuenta
  debe aceptar esas mismas credenciales (o no tener autenticación). El caso
  normal — toda la flota en un único servidor Traccar — no se ve afectado.
- La consulta a estos dispositivos vinculados es por sondeo periódico (cada
  pocos segundos), no WebSocket: es la vía usada específicamente por esta
  asociación manual. El proveedor GPS global (`GPS_PROVIDER=traccar`) sí usa
  WebSocket con degradación automática a sondeo, como ya documenta
  [`GPS-INTEGRATION.md`](./GPS-INTEGRATION.md).
