# Fenice Fleet Control

Central de control logístico para la **distribución de combustible** de
**Fenice SpA**.

Camiones cisterna que cargan diésel, gasolinas, kerosene y petróleo combustible
en plantas de almacenamiento y los despachan a estaciones de servicio, faenas,
transportistas, agrícolas e industrias.

Centraliza en una sola aplicación la flota, los pedidos, las órdenes de
trabajo, las rutas, las geocercas, las visitas, las alertas y el estado
comercial de la cartera de clientes.

**Plan actual: Medio.** El sistema de planes permite entregar exactamente lo
contratado cambiando una variable — ver
[`docs/PLAN-ARCHITECTURE.md`](docs/PLAN-ARCHITECTURE.md).

---

## Qué responde la plataforma

- ¿Dónde está cada camión y qué pedido lleva?
- ¿A qué cliente va, por qué ruta y cuánto falta para que llegue?
- ¿Se salió de la ruta planificada? ¿Está fuera de su comuna asignada?
- ¿Pasó por la dirección del cliente? ¿Se quedó el tiempo suficiente para
  entregar?
- ¿Qué clientes llevan semanas sin comprar? ¿Cuáles llevan meses?
- ¿Dónde se concentra la cartera y en qué zonas hay poca presencia?

---

## Instalación

Requiere **Node.js 20 o superior**.

```bash
npm install
cp .env.example .env.local   # opcional: arranca sin configurar nada
npm run dev
```

Abrir <http://localhost:3000>.

**Sin configurar nada, no hay login** (`AUTH_ENABLED=false` por defecto):
abierta para desarrollo y demostración. Para producción, `AUTH_ENABLED=true`
exige iniciar sesión con RUT y contraseña contra una tabla propia en Supabase
— sin Supabase Auth. Ver [`docs/SUPABASE-INTEGRATION.md`](docs/SUPABASE-INTEGRATION.md).

Al arrancar sin configuración, el sistema opera en **modo demostración**: un
simulador GPS mueve la flota por rutas reales de Santiago y un dataset interno
de 372 clientes, 12 vehículos y 11 rutas alimenta todos los módulos. No es
decorado: los datos recorren exactamente los mismos motores de reglas que
recorrerán los datos reales.

---

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm start` | Servidor de producción (requiere `build` previo) |
| `npm run lint` | ESLint sobre `src/` |
| `npm run typecheck` | TypeScript en modo estricto, sin emitir |
| `npm test` | Suite de pruebas (Vitest) |
| `npm run verify` | typecheck + lint + test + build, en ese orden |
| `npm run build:rutas` | Recalcula la geometría real por calle de las rutas demo |
| `npm run import:comunas` | Reimporta los límites comunales oficiales de Chile |
| `npm run demo:reset` | Reinicia el mundo de demostración |
| `npm run demo:purge` | **Elimina toda la información de demostración** |

---

## Arquitectura

### El principio central: proveedores desacoplados

La plataforma **no está acoplada a ninguna fuente de datos**. Hoy consume un
simulador y un dataset interno; mañana consumirá un servidor Traccar y la base
de datos de Fenice. Cambiar de fuente es cambiar una variable de entorno.

Esto se sostiene sobre dos contratos:

```
GpsProvider                      ExternalOperationsProvider
├── MockGpsProvider              ├── MockOperationsProvider
├── TraccarGpsProvider           └── DatabaseOperationsProvider
└── HttpGpsProvider (navegador)
```

**Ningún componente visual importa un proveedor concreto.** Todos consumen la
interfaz. `src/services/registry.ts` es el único lugar donde se decide qué
implementación se instancia.

El navegador implementa el **mismo contrato** sobre HTTP (`HttpGpsProvider`),
lo que cumple una doble función: la UI no sabe si detrás hay un simulador o un
Traccar real, y las credenciales del servidor GPS nunca salen del servidor.

### Los motores de reglas

Toda decisión operacional vive en una función pura, testeada, fuera de los
componentes. Ningún componente calcula un color, un estado o un umbral.

| Motor | Responsabilidad |
|---|---|
| `calculateClientActivityStatus()` | Estado comercial del cliente (verde / amarillo / rojo) |
| `GeofenceEngine` | Pertenencia, entradas, salidas, permanencia y validación de visita |
| `RouteComplianceEngine` | Desvío de ruta, avance, detenciones y control por comuna |
| `gps-health` | Salud de la telemetría y estado operacional del vehículo |
| `EtaService` | Tiempo estimado de llegada |

Cuando Fenice quiera cambiar el umbral de cliente dormido de 60 a 90 días,
se cambia en `/configuración` y se propaga a los pines del mapa, los KPIs, las
alertas y los informes. No hay un solo `if (dias > 60)` disperso en la interfaz.

### Estructura del proyecto

```
src/
├── app/                    Rutas de Next.js (App Router)
│   ├── api/                Endpoints: proxy GPS, agregaciones, seguimiento
│   ├── mapa/               Centro operacional
│   ├── flota/  clientes/  ordenes/  rutas/
│   ├── alertas/  territorio/  configuracion/
│   └── seguimiento/        Seguimiento público, sin login
│
├── components/
│   ├── map/                MapLibre: capas, iconos, filtros, fichas
│   ├── shell/              Barra lateral, encabezado, navegación móvil
│   ├── ui/                 Primitivas (botón, hoja, tabla, estados vacíos)
│   └── common/             KPIs, línea de tiempo, distintivos de estado
│
├── lib/
│   ├── geo.ts              Geodesia: haversine, proyecciones, punto-en-polígono
│   ├── engines/            Motores de reglas (+ sus pruebas)
│   ├── format.ts           Presentación es-CL
│   └── auth.ts             Andamiaje de autenticación (inerte hoy)
│
├── services/
│   ├── gps/                Contrato + mock + traccar + cliente HTTP
│   ├── operations/         Contrato + mock + base externa + mapeador
│   ├── aggregation/        Composición de modelos de vista
│   ├── eta/  geocoding/  settings/
│   └── registry.ts         Selección de implementación
│
├── types/                  Modelo de datos canónico
├── config/                 Entorno validado + reglas operacionales
└── data/                   Dataset de demostración (determinista)
```

---

## Rutas

### Aplicación interna

| Ruta | Plan | Contenido |
|---|---|---|
| `/` | Básico | Panel operacional: KPIs de flota, despachos, cartera y alertas |
| `/control` | **Medio** | Torre de control: mapa y panel operacional en una pantalla |
| `/despachos` | **Medio** | Entregas en curso y cumplimiento de ventana |
| `/configuracion/geocercas` | Básico | Editor de geocercas con reglas de alerta |
| `/mapa` | Básico | Centro de control: capas, filtros, seguimiento y fichas |
| `/flota` · `/flota/[id]` | Vehículos, telemetría, recorrido e historial |
| `/clientes` · `/clientes/[id]` | Cartera, estado comercial, visitas y pedidos |
| `/clientes/dormidos` | Riesgo comercial escalonado, con vista en mapa |
| `/ordenes` · `/ordenes/[id]` | Órdenes de trabajo y trazabilidad GPS |
| `/rutas` · `/rutas/[id]` | Planificación, corredor y avance por parada |
| `/alertas` | Centro de alertas con filtros y resolución |
| `/territorio` | Cobertura, concentración y sectores sin presencia |
| `/configuracion` | Umbrales operacionales y estado de integraciones |

### Pública

| Ruta | Contenido |
|---|---|
| `/seguimiento` | Seguimiento de pedido por número de OT o de pedido. Sin login |

---

## El mapa

El mapa **no es un adorno dentro de una tarjeta**: ocupa toda la superficie
disponible y es el centro de la aplicación.

**Capas combinables:** camiones, clientes, rutas, geocercas, mapa de calor,
pedidos pendientes, alertas y comunas.

**Rendimiento:** los clientes se agrupan en clústeres (el color del grupo
refleja su composición, de modo que una concentración de clientes dormidos se
ve roja aunque esté agrupada). Los vehículos se interpolan entre reportes para
que el movimiento sea continuo en vez de a saltos.

**Filtros:** estado comercial, comuna, nombre, código, dirección, antigüedad
sin comprar, antigüedad sin visita, presencia de pedido y visitas del día.
Siempre visible el recuento `N de M clientes visibles` y el botón de limpiar.

**Simbología:** el cliente es un pin de gota con el color de su estado
comercial; el vehículo, un disco con flecha de rumbo y su patente debajo; la
parada de ruta, un círculo numerado. Tres formas distintas para que se
distingan aunque coincidan en la misma manzana.

**Rutas por calle.** El corredor planificado no une las paradas en línea
recta: es el trazado real calculado con un servicio de ruteo (OSRM) y
precalculado con `npm run build:rutas` en
[`src/data/route-geometry.json`](src/data/route-geometry.json).

Se precalcula en vez de consultarlo al arrancar para que el servidor levante
al instante, la demostración funcione sin conexión y no se golpee un servicio
público en cada arranque. Cada entrada lleva la huella de sus paradas: si el
dataset cambia, la entrada deja de coincidir y la ruta vuelve a un trazado
aproximado en lugar de mostrar una geometría que no le corresponde.

**Proveedor de cartografía desacoplado.** Por defecto usa OpenStreetMap sin
clave, fuertemente desaturado para que el basemap sea una guía de calles y
todo el color de la pantalla quede en los datos operacionales. Para producción
comercial, configurar MapTiler o Mapbox con `NEXT_PUBLIC_MAP_PROVIDER`.

---

## Modo demostración

El simulador mueve cada vehículo por su corredor planificado, se detiene en las
geocercas de los clientes, genera desvíos y pierde señal ocasionalmente.

- Precarga 2,5 horas de historial al arrancar, para que gráficos y líneas de
  tiempo no nazcan vacíos.
- Es **determinista**: la misma semilla produce siempre el mismo mundo, así la
  demostración es reproducible y las cifras no bailan entre recargas.
- Avanza con el tiempo real transcurrido desde el arranque, no con la hora del
  día: la demostración se ve viva a cualquier hora.
- **Se puede pausar** desde el encabezado, para explicar una pantalla sin que
  los camiones se muevan.

El encabezado muestra siempre `GPS: DEMO` (ámbar) o `GPS: CONECTADO` (verde),
junto con la antigüedad de la última posición y el transporte en uso.

---

## Configuración

Todos los umbrales operacionales se editan en `/configuracion` y se aplican de
inmediato a los motores de reglas:

- **Clientes:** días para verde, amarillo y rojo.
- **GPS:** advertencia, posible pérdida de señal, offline, cadencia de
  refresco y umbral de movimiento.
- **Ruta:** tolerancia de desvío en metros y en segundos, tolerancia fuera de
  comuna y detención prolongada.
- **Geocercas:** radio predeterminado, permanencia mínima y confirmación
  automática de entrega.

Los valores iniciales vienen de variables de entorno (ver `.env.example`). La
persistencia definitiva se habilita al conectar la base interna
(`DATABASE_URL`); mientras tanto los cambios viven en el proceso, y la interfaz
lo indica.

---

## Integraciones pendientes

Ambas están **implementadas y desacopladas**, esperando credenciales:

| Integración | Documento | Qué falta |
|---|---|---|
| **GPS real (Traccar)** | [`docs/GPS-INTEGRATION.md`](docs/GPS-INTEGRATION.md) | URL del servidor, token e IMEI reales de los FMC130 |
| **Base de datos de Fenice** | [`docs/EXTERNAL-DATABASE-INTEGRATION.md`](docs/EXTERNAL-DATABASE-INTEGRATION.md) | Motor, credenciales de solo lectura y esquema real |
| **Tráfico en tiempo real** | [`docs/MAP-PROVIDERS.md`](docs/MAP-PROVIDERS.md) | `TRAFFIC_PROVIDER` y su clave |
| **Satélite e híbrido** | [`docs/MAP-PROVIDERS.md`](docs/MAP-PROVIDERS.md) | Clave de MapTiler o Mapbox |

Ninguna de ellas se finge: sin proveedor, la función aparece marcada como
*requiere proveedor configurado* en lugar de mostrar datos inventados.

## Documentación

| Documento | Contenido |
|---|---|
| [`PLAN-ARCHITECTURE.md`](docs/PLAN-ARCHITECTURE.md) | Sistema de planes y cómo entregar cada versión |
| [`DEMO-DATA.md`](docs/DEMO-DATA.md) | Mundo de demostración y cómo eliminarlo |
| [`ADMIN-BOUNDARIES-CHILE.md`](docs/ADMIN-BOUNDARIES-CHILE.md) | Límites comunales oficiales |
| [`MAP-PROVIDERS.md`](docs/MAP-PROVIDERS.md) | Mapa, satélite, tráfico, ruteo y geocodificación |
| [`DRIVER-PORTAL.md`](docs/DRIVER-PORTAL.md) | Portal del conductor: enlaces, evidencia y trabajo sin conexión |
| [`GEOFENCE-DELIVERY.md`](docs/GEOFENCE-DELIVERY.md) | Cómo se detecta una entrega y por qué se corta el seguimiento |
| [`CUSTOMER-TRACKING.md`](docs/CUSTOMER-TRACKING.md) | Seguimiento público del cliente y su privacidad |
| [`GPS-INTEGRATION.md`](docs/GPS-INTEGRATION.md) | Conectar el servidor Traccar |
| [`3DTRACKING-INTEGRATION.md`](docs/3DTRACKING-INTEGRATION.md) | Conectar la telemetría real de 3DTracking |
| [`EXTERNAL-DATABASE-INTEGRATION.md`](docs/EXTERNAL-DATABASE-INTEGRATION.md) | Conectar la base de Fenice (solo clientes y despachos) |
| [`SUPABASE-INTEGRATION.md`](docs/SUPABASE-INTEGRATION.md) | Login, flota, rutas, geocercas y evidencia en Supabase |
| [`BASELINE-PLAN-BASICO.md`](docs/BASELINE-PLAN-BASICO.md) | Línea base del Plan Básico, para no-regresión |

**El esquema de la base de Fenice no está asumido.** El mapeo es declarativo
(`ExternalSchemaMapping`) y hay una prueba que verifica que un esquema
completamente distinto funciona sin tocar otra línea de código.

---

## Seguridad

- **Credenciales solo en el servidor.** El navegador nunca ve el token de
  Traccar ni la cadena de conexión a la base de Fenice. Consume `/api/*`, que
  actúa como proxy.
- **Solo lectura sobre el ERP.** Doble garantía: permisos de base de datos y
  una guarda en la aplicación que rechaza toda sentencia que no sea `SELECT`
  antes de tocar la red.
- **Seguimiento público acotado.** `/seguimiento` expone una proyección mínima:
  el pedido consultado, su estado, la posición del vehículo asignado y el ETA.
  No expone otros clientes, otras OT, la ruta completa, el historial del camión
  ni datos comerciales. La patente se muestra parcialmente enmascarada. La
  posición deja de compartirse una vez entregado el pedido.
- **Login propio, sin Supabase Auth.** `AUTH_ENABLED=true` exige RUT y
  contraseña validados contra la tabla `usuarios` (bcrypt, costo 12), con
  sesiones propias por cookie `httpOnly`/`secure`/`SameSite=Lax` — nunca se
  delega la autenticación en el sistema de usuarios de Supabase. Bloqueo por
  intentos fallidos, auditoría de login y de acciones administrativas. Ver
  [`docs/SUPABASE-INTEGRATION.md`](docs/SUPABASE-INTEGRATION.md).
- **CSRF.** Toda ruta que muta estado verifica que `Origin`/`Referer`
  coincida con el propio sitio, ademas de la cookie `SameSite=Lax`.
- **Cabeceras de seguridad HTTP** (`X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy`, HSTS) en toda respuesta.

---

## Identidad visual

Tema claro empresarial: fondo neutro frío, tarjetas blancas y azul marino para
el texto. La jerarquía la dan la elevación y el espacio, no el color de fondo;
los acentos azul y cyan se reservan para datos vivos y acciones.

Todos los pares de color de la interfaz cumplen **WCAG AA (≥ 4,5:1)**,
verificado por medición, incluidos los estados verde / ámbar / rojo de la
cartera de clientes y el texto blanco sobre los botones sólidos.

## Responsive

Diseñada para operar desde el teléfono en terreno, no solo desde el escritorio.

- Verificada desde **320 px** hasta pantallas grandes.
- Barra lateral → menú deslizable + barra inferior de accesos rápidos.
- Filtros y fichas de camión y cliente → hojas inferiores (patrón nativo).
- Tablas densas → tarjetas adaptativas (una tabla de 8 columnas es ilegible en
  375 px).
- Controles primarios (botones, campos, navegación) de 44 px mínimo;
  referencias secundarias dentro de listas densas, 32 px.
- Áreas seguras respetadas (notch e isla dinámica).
- **Sin desplazamiento horizontal en ningún ancho**, verificado con navegador
  headless en 320, 375, 390, 430, 768, 1024 y 1440 px sobre las once páginas.

---

## Pruebas

```bash
npm test
```

245 pruebas sobre lo que decide el comportamiento del sistema: estado comercial
del cliente, motor de geocercas, cumplimiento de ruta, salud y normalización
GPS, filtros del mapa, mapeo de datos externos, estados de OT, ETA, geodesia y
formato.

Las pruebas no persiguen cobertura: cubren las reglas cuyo fallo sería costoso.
Tres ejemplos de reglas con prueba dedicada, todas surgidas de fallos reales
detectados durante el desarrollo:

- **Evidencia de paso ≠ confirmación de entrega.** Un camión que pasa frente al
  domicilio sin detenerse deja evidencia, no una entrega.
- **Cerrar una ruta no cierra entregas inexistentes.** Una parada a la que el
  vehículo nunca llegó se reporta como incidencia, nunca como completada.
- **La barra del cliente final no llega al 100 % con el pedido en camino.**
  Mostrar el pedido como entregado antes de tiempo destruye la confianza.

---

## Tecnología

Next.js 15 (App Router) · React 19 · TypeScript estricto · Tailwind CSS ·
MapLibre GL JS · TanStack Query · Zustand · Zod · date-fns · Lucide · Vitest
