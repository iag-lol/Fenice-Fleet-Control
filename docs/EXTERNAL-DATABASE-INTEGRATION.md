# Integración con la base de datos de Fenice

Cómo reemplazar el dataset de demostración por los datos reales de clientes,
pedidos, despachos, rutas y órdenes de trabajo.

**Estado actual:** `OPERATIONS_PROVIDER=mock`. La estructura de conexión, el
mapeo y las guardas de solo lectura están implementadas. **Faltan tres cosas
que solo Fenice puede aportar:** credenciales, el esquema real y el driver del
motor.

---

## 1. Principio no negociable: solo lectura

La base de datos de Fenice es el sistema de registro de la operación. Esta
plataforma **la lee y no la modifica jamás.** Un error aquí no es un bug de
software: es corrupción de datos de negocio.

La garantía es doble, y ambas capas son necesarias:

**Capa 1 — permisos de base de datos.** El usuario que se entregue debe tener
permisos exclusivamente de lectura. Ejemplo en PostgreSQL:

```sql
CREATE USER fenice_fleet_ro WITH PASSWORD '...';
GRANT CONNECT ON DATABASE fenice_erp TO fenice_fleet_ro;
GRANT USAGE ON SCHEMA public TO fenice_fleet_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO fenice_fleet_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO fenice_fleet_ro;
```

**Capa 2 — guarda en la aplicación.** `DatabaseOperationsProvider.read()` es el
único punto por donde pasa una sentencia SQL, y rechaza antes de tocar la red
todo lo que no empiece por `SELECT` o `WITH`, y todo lo que contenga
`INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE`, `CREATE`, `GRANT`,
`MERGE`, `REPLACE`, `CALL` o `EXEC`.

La capa 2 no sustituye a la capa 1. Es una red de seguridad para el caso de que
alguien, en el futuro, escriba una consulta descuidada.

**Todo acceso ocurre en el servidor.** El navegador nunca ve la cadena de
conexión ni ejecuta consultas: consume las rutas de `/api/*`.

---

## 2. Qué escribe la plataforma (y dónde)

Hay datos que la plataforma **genera** y que la base de Fenice no contiene:

| Dato | Dónde vive hoy | Dónde debe vivir |
|---|---|---|
| Geocercas de entrega | Memoria del proceso | Base interna (`DATABASE_URL`) |
| Eventos de geocerca | Memoria del proceso | Base interna |
| Visitas detectadas por GPS | Memoria del proceso | Base interna |
| Estado de alertas (revisada/resuelta) | Memoria del proceso | Base interna |
| Configuración operacional | Memoria del proceso | Base interna |
| Caché de geocodificación | Memoria del proceso | Base interna |

Esto **no viola** el contrato de solo lectura: son artefactos propios de esta
plataforma, no del ERP. Se escriben en una base PostgreSQL separada
(`DATABASE_URL`), nunca en la de Fenice.

---

## 3. Variables de entorno

```bash
OPERATIONS_PROVIDER=external

EXTERNAL_DB_ENGINE=postgres      # postgres | mysql | sqlserver | oracle
EXTERNAL_DB_HOST=10.0.0.15
EXTERNAL_DB_PORT=5432
EXTERNAL_DB_NAME=fenice_erp
EXTERNAL_DB_USER=fenice_fleet_ro
EXTERNAL_DB_PASSWORD=...
EXTERNAL_DB_SCHEMA=public        # opcional
EXTERNAL_DB_SSL=true

# Base interna de la plataforma (artefactos propios)
DATABASE_URL=postgresql://usuario:clave@host:5432/fenice_fleet
```

Si falta alguna variable obligatoria, la plataforma **falla al arrancar con un
mensaje explícito** que nombra exactamente qué falta. Es deliberado: preferimos
un error claro a una conexión silenciosamente rota que muestre pantallas
vacías sin explicación.

---

## 4. Driver

**Esto requiere una decisión de Fenice: qué motor de base de datos usa el ERP.**

No se instalaron los cuatro drivers "por si acaso" — sería peso muerto y
superficie de ataque innecesaria. Una vez conocido el motor:

```bash
# PostgreSQL
npm install pg && npm install -D @types/pg

# MySQL / MariaDB
npm install mysql2

# SQL Server
npm install mssql

# Oracle
npm install oracledb
```

Después, completar `createExternalQueryExecutor()` en
`src/services/operations/database/database-operations-provider.ts`. La interfaz
que debe satisfacer es mínima:

```ts
export interface ExternalQueryExecutor {
  query(sql: string, params?: readonly unknown[]): Promise<ExternalQueryResult>;
  close(): Promise<void>;
}
```

Ejemplo con PostgreSQL:

```ts
import { Pool } from 'pg';

export function createExternalQueryExecutor(): ExternalQueryExecutor {
  const env = getServerEnv();

  const pool = new Pool({
    host: env.EXTERNAL_DB_HOST,
    port: env.EXTERNAL_DB_PORT,
    database: env.EXTERNAL_DB_NAME,
    user: env.EXTERNAL_DB_USER,
    password: env.EXTERNAL_DB_PASSWORD,
    ssl: env.EXTERNAL_DB_SSL ? { rejectUnauthorized: false } : false,
    // Un ERP en producción no debe verse afectado por esta plataforma:
    // pocas conexiones y timeouts cortos.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    statement_timeout: 15_000,
  });

  return {
    async query(sql, params) {
      const started = performance.now();
      const result = await pool.query(sql, params ? [...params] : undefined);
      return { rows: result.rows, latencyMs: Math.round(performance.now() - started) };
    },
    async close() {
      await pool.end();
    },
  };
}
```

**Nota sobre marcadores de posición:** las consultas usan la sintaxis `$1, $2`
de PostgreSQL. MySQL usa `?` y SQL Server `@p1`. Si el motor no es PostgreSQL,
hay que traducirlos dentro del ejecutor — es el lugar correcto, porque es la
única pieza que conoce el dialecto.

---

## 5. Adapter y mapper: por qué el esquema no está asumido

**No se inventaron nombres definitivos de tablas de Fenice.** Sería una
apuesta, y equivocarse obligaría a reescribir consultas por toda la
plataforma.

En su lugar, el mapeo es **declarativo**. Vive en
`src/services/operations/database/external-data-mapper.ts`:

```ts
export const PROVISIONAL_SCHEMA_MAPPING: ExternalSchemaMapping = {
  clients: {
    table: 'clientes',
    columns: {
      id: 'cliente_id',
      code: 'codigo',
      tradeName: 'nombre_fantasia',
      lastPurchaseAt: 'fecha_ultima_compra',
      // ...
    },
  },
  // ...
};
```

Los nombres actuales son **una hipótesis de trabajo** basada en convenciones
frecuentes de ERP chilenos, explícitamente marcada como provisional.

**Cuando Fenice entregue el esquema real, se edita este objeto y nada más.**
Hay una prueba automatizada que lo verifica: `external-data-mapper.test.ts`
contiene un caso que mapea un esquema completamente distinto (en inglés) y
comprueba que el resultado sigue siendo correcto sin tocar otra línea de
código.

### Qué se necesita de Fenice

Para completar el mapeo:

1. **Motor y versión** de la base de datos.
2. **Host, puerto y nombre** de la base (o de la réplica de lectura).
3. **Credenciales de solo lectura.**
4. **Nombres de tablas o vistas** para: clientes, direcciones de cliente,
   pedidos, detalle de pedidos, órdenes de trabajo, rutas, camiones y
   conductores.
5. **Nombres de columnas** y sus tipos.
6. **Relaciones**: cómo se une un pedido con su cliente, con su dirección de
   despacho y con su orden de trabajo.
7. **Diccionario de estados**: qué valores toma el campo de estado de un pedido
   y de una OT, y qué significa cada uno.

Si Fenice prefiere no exponer las tablas directamente, **una vista de solo
lectura por entidad es una solución igual de válida** y probablemente más
limpia: aísla a la plataforma de cambios internos del ERP.

---

## 6. Campos que la plataforma necesita

Mínimo indispensable para que cada módulo funcione:

### Clientes
| Campo interno | Obligatorio | Para qué |
|---|---|---|
| `id` | Sí | Identidad |
| `code` | Sí | Búsqueda y visualización |
| `tradeName` / `legalName` | Sí (uno) | Visualización |
| `taxId` | No | Búsqueda por RUT |
| `lastPurchaseAt` | **Sí** | **Estado comercial verde/amarillo/rojo** |
| `lastVisitAt` | No | Señal complementaria de actividad |
| `totalOrders`, `lifetimeValue` | No | Ponderación del mapa de calor |
| `salesRep` | No | Responsable en clientes dormidos |

Sin `lastPurchaseAt` **no hay pines de colores**: todos los clientes se
clasificarían como dormidos. Es el campo más crítico del módulo comercial.

### Direcciones de cliente
| Campo | Obligatorio | Para qué |
|---|---|---|
| `id`, `clientId` | Sí | Identidad y relación |
| `addressLine`, `communeName` | Sí | Visualización |
| `lat` / `lng` | **Sí para el mapa** | Pines, geocercas y detección de visitas |
| `isPrimary` | No | Elegir la dirección a mostrar |

**Si no hay coordenadas**, la plataforma lo detecta y genera una alerta
`pedido_sin_coordenadas` en vez de fallar. Esas direcciones no aparecen en el
mapa ni pueden generar geocerca. Para resolverlo hay dos caminos: que Fenice
las geocodifique en origen, o activar `GEOCODING_PROVIDER` y resolverlas de
forma controlada desde la plataforma.

### Órdenes de trabajo
| Campo | Obligatorio | Para qué |
|---|---|---|
| `id`, `number` | Sí | Identidad y seguimiento público |
| `orderId`, `orderNumber` | Sí | Enlace con el pedido |
| `clientId`, `addressLine`, `communeCode` | Sí | Destino |
| `lat` / `lng` | Sí para geocercas | Detección automática de visita |
| `vehicleId` | Sí | Asignación y seguimiento |
| `scheduledDate`, ventana horaria | Sí | Detección de atrasos |
| `status`, `priority` | Sí | Estado operacional |

### Rutas
El **corredor planificado** (la polilínea) casi con seguridad no existe en el
ERP. Hay dos opciones:

1. Reconstruirlo uniendo las paradas en secuencia (aproximado pero suficiente
   para detectar desvíos grandes).
2. Calcularlo con un proveedor de ruteo real (`ROUTING_PROVIDER=osrm`).

Sin corredor, la detección de desvío de ruta no funciona; el resto de la
plataforma sí.

---

## 7. Cambio de `mock` a `external`, paso a paso

```bash
# 1. Verificar conectividad de red hacia la base
nc -zv 10.0.0.15 5432

# 2. Verificar que el usuario NO puede escribir (debe fallar)
psql -h 10.0.0.15 -U fenice_fleet_ro -d fenice_erp \
  -c "CREATE TABLE prueba_escritura (id int);"
# Se espera: ERROR: permission denied

# 3. Instalar el driver y completar createExternalQueryExecutor()

# 4. Ajustar PROVISIONAL_SCHEMA_MAPPING al esquema real

# 5. Configurar .env.local y reiniciar
OPERATIONS_PROVIDER=external
```

### Verificación

1. **`GET /api/system/mode`** debe devolver `"provider": "external"`,
   `"simulated": false`, `"readOnly": true`.
2. **`/configuracion`** muestra el estado de las integraciones: la tarjeta
   "Fuente operacional" debe pasar de *Demo* a *Conectado*.
3. **`GET /api/clients`** debe devolver clientes reales con estado comercial
   calculado. Si todos salen rojos, `lastPurchaseAt` no se está mapeando.
4. **`/territorio`** debe mostrar la distribución real por comuna.
5. **`/ordenes`** debe listar las OT del día.

### Qué esperar que falle primero

- **Todos los clientes en rojo.** `lastPurchaseAt` no se mapea o llega en un
  formato de fecha no reconocido. El mapeador acepta ISO, epoch, `Date`,
  `dd-mm-yyyy` y `dd/mm/yyyy`; cualquier otro formato hay que añadirlo en
  `readDate()`.
- **Mapa vacío de clientes.** Faltan coordenadas, o llegan como texto con coma
  decimal. `readNumber()` ya maneja la coma, pero conviene verificarlo.
- **Estados de OT todos en "pendiente".** El diccionario
  `statusDictionaries.workOrderStatus` no contiene los valores reales de
  Fenice. El mapeador cae a `pendiente` a propósito: nunca inventa un estado
  avanzado a partir de un valor desconocido.

---

## 8. Volver al modo demostración

```bash
OPERATIONS_PROVIDER=mock
```

Útil para demostrar la plataforma sin exponer datos reales de clientes.
