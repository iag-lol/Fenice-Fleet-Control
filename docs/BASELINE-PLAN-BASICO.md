# Baseline del Plan Básico

Inventario de la línea base funcional aprobada, registrado **antes** de
incorporar el Plan Medio. Sirve como referencia de no-regresión: cualquier
elemento de esta lista debe seguir funcionando igual o mejor.

Registrado el 2026-08-27.

## Verificación de partida

| Comprobación | Resultado |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (0 errores, 0 avisos) |
| `npm run test` | PASS (206 pruebas) |
| `npm run build` | PASS |

## Volumen

| | |
|---|---|
| Rutas de aplicación | 15 |
| Endpoints de API | 22 |
| Componentes | 46 |
| Motores de reglas | 4 |
| Líneas de TypeScript | 24.041 |

## Rutas del Plan Básico

`/` · `/mapa` · `/flota` · `/flota/[id]` · `/clientes` · `/clientes/[id]` ·
`/clientes/dormidos` · `/ordenes` · `/ordenes/[id]` · `/rutas` · `/rutas/[id]` ·
`/alertas` · `/territorio` · `/configuracion` · `/seguimiento`

## Funcionalidades a preservar

**Operación** — panel con KPIs de flota, despachos, cartera y alertas;
tendencia semanal de entregas; rutas en curso con avance.

**Mapa** — capas combinables (camiones, clientes, rutas, geocercas, calor,
pedidos, alertas, comunas); agrupamiento de clientes; filtros comerciales con
recuento visible; fichas de vehículo y cliente; modo seguir vehículo; pantalla
completa; leyenda.

**Flota** — listado con telemetría viva; detalle con posición, recorrido,
avance de ruta e historial de jornada.

**Clientes** — cartera con estado verde/ámbar/rojo calculado por motor;
clientes dormidos escalonados; detalle con visitas GPS y pedidos.

**Órdenes** — listado filtrable; detalle con trazabilidad GPS y evidencia.

**Rutas** — listado con avance; detalle con corredor por calle y paradas.

**Alertas** — centro con filtros y ciclo de vida (nueva / revisada / resuelta).

**Territorio** — cobertura por comuna, mapa de calor, sectores sin presencia.

**Configuración** — umbrales operacionales que alimentan los motores en vivo.

**Seguimiento público** — consulta por número de OT sin autenticación.

## Motores de reglas

`calculateClientActivityStatus` · `GeofenceEngine` · `RouteComplianceEngine` ·
`gps-health` · `EtaService`

## Arquitectura a conservar

- `GpsProvider` → `MockGpsProvider` / `TraccarGpsProvider` / `HttpGpsProvider`
- `ExternalOperationsProvider` → `MockOperationsProvider` / `DatabaseOperationsProvider`
- `ExternalDataMapper` con mapeo declarativo del esquema externo
- Registro de proveedores como único punto de selección
- Andamiaje de autenticación inerte (`AUTH_ENABLED=false`)
