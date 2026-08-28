import { DEFAULT_OPERATIONAL_SETTINGS } from '@/config/operational';
import { COMMUNES } from '@/data/communes';
import {
  buildPlate,
  buildRut,
  CLIENT_TYPES,
  COMPANY_ROOTS,
  COMPANY_SUFFIXES,
  FIRST_NAMES,
  FUEL_PRODUCTS,
  LAST_NAMES,
  SALES_REPS,
  STREET_NAMES,
  TANKER_MODELS,
  TERMINALS,
} from '@/demo/catalog';
import { SeededRandom } from '@/demo/random';
import routeGeometry from '@/demo/route-geometry.json';
import { haversineMeters, interpolate, pointInPolygon, polylineLengthMeters } from '@/lib/geo';
import {
  asClientId,
  asDeviceId,
  asDriverId,
  asGeofenceId,
  asOrderId,
  asRouteId,
  asVehicleId,
  asWorkOrderId,
  type Client,
  type ClientLocation,
  type Commune,
  type Driver,
  type Geofence,
  type LatLng,
  type Order,
  type OrderLine,
  type Route,
  type RouteStop,
  type Vehicle,
  type WorkOrder,
  type WorkOrderPriority,
} from '@/types/core';

/**
 * Dataset de demostracion de Fenice Fleet Control.
 *
 * DOMINIO: distribucion de combustible. Camiones cisterna que cargan diesel,
 * gasolinas, kerosene y petroleo combustible en plantas de almacenamiento y
 * los despachan a estaciones de servicio, faenas, transportistas y agricolas.
 *
 * Sustituye temporalmente a la base de datos externa de Fenice mientras no se
 * disponga de acceso de solo lectura. Es completamente determinista: la misma
 * semilla produce siempre el mismo mundo, de modo que la demo es reproducible
 * y las cifras no bailan entre recargas.
 *
 * Este modulo NO se importa desde ningun componente. Solo el
 * `MockOperationsProvider` y el simulador GPS lo consumen, y unicamente
 * cuando el modo demostracion esta activo.
 */

export interface DemoDataset {
  generatedAt: string;
  seed: number;
  communes: readonly Commune[];
  drivers: Driver[];
  vehicles: Vehicle[];
  clients: Client[];
  orders: Order[];
  workOrders: WorkOrder[];
  routes: Route[];
  geofences: Geofence[];
  /** Indices para consulta O(1) desde el proveedor. */
  index: {
    clientById: Map<string, Client>;
    orderById: Map<string, Order>;
    orderByNumber: Map<string, Order>;
    workOrderById: Map<string, WorkOrder>;
    workOrderByNumber: Map<string, WorkOrder>;
    routeById: Map<string, Route>;
    vehicleById: Map<string, Vehicle>;
    driverById: Map<string, Driver>;
    geofenceById: Map<string, Geofence>;
    locationById: Map<string, ClientLocation>;
  };
}

const MS_PER_DAY = 86_400_000;

/**
 * Proporcion util del estanque.
 *
 * No se carga al 100 %: el combustible se dilata con la temperatura y la
 * normativa exige dejar camara de expansion.
 */
const TANK_FILL_RATIO = 0.95;

/**
 * Distribucion de la cartera por comuna, con los codigos oficiales de la DPA.
 *
 * Refleja la huella real de una distribuidora de combustible en la Region
 * Metropolitana: peso alto en las comunas industriales y logisticas del anillo
 * poniente y norte (Quilicura, Pudahuel, Maipu, Renca, Cerrillos), donde se
 * concentran terminales, transportistas y faenas; peso medio en las comunas
 * urbanas con muchas estaciones de servicio; y presencia baja en las provincias
 * rurales del sur y poniente, que son justamente las zonas que la vista
 * territorial debe senalar como oportunidad.
 */
const COMMUNE_WEIGHTS: Record<string, number> = {
  // --- Eje industrial y logistico ---
  '13125': 34, // Quilicura
  '13124': 30, // Pudahuel
  '13119': 30, // Maipu
  '13128': 24, // Renca
  '13102': 22, // Cerrillos
  '13106': 20, // Estacion Central
  '13107': 16, // Huechuraba

  // --- Nucleo urbano con estaciones de servicio ---
  '13101': 26, // Santiago
  '13201': 24, // Puente Alto
  '13110': 22, // La Florida
  '13120': 18, // Nunoa
  '13130': 16, // San Miguel
  '13122': 15, // Penalolen
  '13114': 14, // Las Condes
  '13123': 12, // Providencia
  '13127': 12, // Recoleta
  '13104': 11, // Conchali
  '13126': 11, // Quinta Normal
  '13118': 10, // Macul
  '13109': 10, // La Cisterna
  '13121': 10, // Pedro Aguirre Cerda
  '13129': 9, // San Joaquin
  '13105': 9, // El Bosque
  '13112': 9, // La Pintana
  '13111': 8, // La Granja
  '13131': 7, // San Ramon
  '13116': 7, // Lo Espejo
  '13103': 7, // Cerro Navia
  '13117': 6, // Lo Prado
  '13108': 6, // Independencia
  '13113': 6, // La Reina
  '13132': 6, // Vitacura
  '13115': 4, // Lo Barnechea

  // --- Corredor sur: agricola, faenas y ruta 5 ---
  '13401': 20, // San Bernardo
  '13402': 12, // Buin
  '13404': 10, // Paine
  '13403': 8, // Calera de Tango

  // --- Corredor norte: agroindustria y aridos ---
  '13301': 12, // Colina
  '13302': 10, // Lampa
  '13303': 4, // Tiltil

  // --- Provincia de Talagante ---
  '13605': 8, // Penaflor
  '13601': 7, // Talagante
  '13604': 6, // Padre Hurtado
  '13602': 5, // El Monte
  '13603': 5, // Isla de Maipo

  // --- Zonas de baja presencia: la oportunidad territorial ---
  '13501': 6, // Melipilla
  '13503': 3, // Curacavi
  '13202': 3, // Pirque
  '13203': 2, // San Jose de Maipo
  '13505': 2, // San Pedro
  '13504': 2, // Maria Pinto
  '13502': 1, // Alhue
};

function isoAt(base: Date, dayOffset: number, hours: number, minutes = 0): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function startOfDay(base: Date): Date {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ---------------------------------------------------------------------------
// Geografia sintetica
// ---------------------------------------------------------------------------

/**
 * Genera nucleos comerciales dentro de la comuna. Los clientes se agrupan en
 * torno a ellos en vez de repartirse uniformemente, que es lo que hace que el
 * mapa de calor muestre algo interesante y realista.
 */
function buildCommercialHubs(commune: Commune, rng: SeededRandom): LatLng[] {
  const hubCount = rng.int(2, 4);
  const hubs: LatLng[] = [];

  for (let i = 0; i < hubCount; i += 1) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate: LatLng = {
        lat: commune.center.lat + rng.float(-0.022, 0.022),
        lng: commune.center.lng + rng.float(-0.026, 0.026),
      };
      if (pointInPolygon(candidate, commune.boundary)) {
        hubs.push(candidate);
        break;
      }
    }
  }

  return hubs.length > 0 ? hubs : [commune.center];
}

function sampleNearHub(hub: LatLng, commune: Commune, rng: SeededRandom): LatLng {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const candidate: LatLng = {
      lat: hub.lat + rng.normal(0, 0.0075, -0.02, 0.02),
      lng: hub.lng + rng.normal(0, 0.0085, -0.024, 0.024),
    };
    if (pointInPolygon(candidate, commune.boundary)) return candidate;
  }
  return hub;
}

/**
 * Traza un recorrido plausible entre dos puntos. No es routing real: emula el
 * trazado ortogonal de la ciudad con un quiebre intermedio y ruido acotado,
 * suficiente para que el corredor de ruta y la deteccion de desvio tengan
 * sentido geometrico.
 */
function buildLeg(from: LatLng, to: LatLng, rng: SeededRandom): LatLng[] {
  const points: LatLng[] = [];
  const distance = haversineMeters(from, to);
  const steps = Math.max(4, Math.min(28, Math.round(distance / 320)));

  // Punto de quiebre: primero avanza en longitud, luego en latitud.
  const corner: LatLng = { lat: from.lat, lng: to.lng };
  const bias = rng.float(0.35, 0.65);
  const via = interpolate(corner, { lat: to.lat, lng: from.lng }, 1 - bias);

  const firstHalf = Math.ceil(steps / 2);
  for (let i = 0; i < firstHalf; i += 1) {
    const p = interpolate(from, via, i / firstHalf);
    points.push({ lat: p.lat + rng.float(-0.0004, 0.0004), lng: p.lng + rng.float(-0.0004, 0.0004) });
  }
  for (let i = 0; i <= steps - firstHalf; i += 1) {
    const p = interpolate(via, to, i / (steps - firstHalf));
    points.push({ lat: p.lat + rng.float(-0.0004, 0.0004), lng: p.lng + rng.float(-0.0004, 0.0004) });
  }

  return points;
}

interface RouteGeometryEntry {
  key: string;
  distanceKm: number;
  /** Coordenadas [lng, lat] tal como las entrega el servicio de ruteo. */
  path: number[][];
}

const ROUTE_GEOMETRY: Record<string, RouteGeometryEntry> = routeGeometry;

/**
 * Huella de los puntos de paso de una ruta.
 *
 * Debe coincidir con la que calcula `scripts/build-route-geometry.ts`. Si el
 * dataset cambia, la huella deja de coincidir y la ruta vuelve al trazado
 * sintetico: es preferible un corredor aproximado a uno real que pertenece a
 * otras paradas.
 */
export function waypointKey(points: LatLng[]): string {
  const raw = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Ordena paradas por vecino mas cercano desde el origen. */
function orderByProximity<T extends { coordinates: LatLng }>(origin: LatLng, items: T[]): T[] {
  const pending = [...items];
  const ordered: T[] = [];
  let cursor = origin;

  while (pending.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let i = 0; i < pending.length; i += 1) {
      const distance = haversineMeters(cursor, pending[i]!.coordinates);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }

    const next = pending.splice(bestIndex, 1)[0]!;
    ordered.push(next);
    cursor = next.coordinates;
  }

  return ordered;
}

// ---------------------------------------------------------------------------
// Generacion
// ---------------------------------------------------------------------------

function buildDrivers(rng: SeededRandom, count: number): Driver[] {
  const drivers: Driver[] = [];
  for (let i = 0; i < count; i += 1) {
    const fullName = `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)} ${rng.pick(LAST_NAMES)}`;
    drivers.push({
      id: asDriverId(`drv-${String(i + 1).padStart(3, '0')}`),
      fullName,
      documentId: buildRut(rng.int(9_000_000, 20_999_999)),
      phone: `+569 ${rng.int(4000, 9999)} ${rng.int(1000, 9999)}`,
      // El transporte de sustancias peligrosas exige licencia A-5 y curso
      // vigente de carga peligrosa.
      licenseClass: 'A-5',
      licenseExpiresAt: isoAt(new Date(), rng.int(40, 900), 12),
      active: true,
    });
  }
  return drivers;
}

function buildVehicles(rng: SeededRandom, drivers: Driver[], count: number): Vehicle[] {
  const vehicles: Vehicle[] = [];

  for (let i = 0; i < count; i += 1) {
    const spec = TANKER_MODELS[i % TANKER_MODELS.length]!;
    const terminal = TERMINALS[i % TERMINALS.length]!;
    const driver = drivers[i] ?? null;
    // Un vehiculo de la flota queda sin equipo para ejercitar el caso real de
    // "vehiculo sin telemetria" en toda la aplicacion.
    const hasDevice = i !== count - 1;

    vehicles.push({
      id: asVehicleId(`veh-${String(i + 1).padStart(3, '0')}`),
      plate: buildPlate(i + 4),
      fleetCode: `C-${100 + i}`,
      brand: spec.brand,
      model: spec.model,
      year: rng.int(2018, 2025),
      type: spec.type,
      capacityLiters: spec.capacityLiters,
      compartments: spec.compartments,
      device: hasDevice
        ? {
            id: asDeviceId(`dev-${String(i + 1).padStart(3, '0')}`),
            imei: `3568${rng.int(10_000_000_000, 99_999_999_999)}`.slice(0, 15),
            model: 'Teltonika FMC130',
            simNumber: `+5697${rng.int(1_000_000, 9_999_999)}`,
            externalId: String(1000 + i),
            installedAt: isoAt(new Date(), -rng.int(60, 700), 10),
          }
        : null,
      driverId: driver ? driver.id : null,
      depotName: terminal.name,
      active: true,
    });
  }

  return vehicles;
}

interface ClientBuildResult {
  clients: Client[];
  orders: Order[];
}

function buildClientsAndOrders(rng: SeededRandom, reference: Date): ClientBuildResult {
  const clients: Client[] = [];
  const orders: Order[] = [];
  const { activeMaxDays, warningMaxDays } = DEFAULT_OPERATIONAL_SETTINGS.clients;

  let clientCounter = 0;
  let orderCounter = 0;

  for (const commune of COMMUNES) {
    const target = COMMUNE_WEIGHTS[commune.code] ?? 8;
    const hubs = buildCommercialHubs(commune, rng);

    for (let i = 0; i < target; i += 1) {
      clientCounter += 1;
      const id = asClientId(`cli-${String(clientCounter).padStart(4, '0')}`);
      const code = `F${String(10_000 + clientCounter)}`;

      // El tipo de cliente decide su nombre comercial Y su segmento: una
      // estacion de servicio y una faena minera no compran lo mismo ni en la
      // misma cantidad.
      const clientType = rng.weighted(CLIENT_TYPES.map((t) => [t, t.weight] as const));
      const root = rng.pick(COMPANY_ROOTS);
      const tradeName = `${clientType.kind} ${root}`;
      const legalName = `${root} ${rng.pick(COMPANY_SUFFIXES)}`;

      const hub = rng.pick(hubs);
      const coordinates = sampleNearHub(hub, commune, rng);

      // Distribucion de antiguedad: mayoria activa, una cola relevante de
      // clientes en riesgo y dormidos, que es lo que da valor a la demo.
      const bucket = rng.weighted([
        ['active', 58],
        ['warning', 24],
        ['dormant', 16],
        ['never', 2],
      ] as const);

      const daysSincePurchase =
        bucket === 'active'
          ? rng.int(0, activeMaxDays)
          : bucket === 'warning'
            ? rng.int(activeMaxDays + 1, warningMaxDays)
            : bucket === 'dormant'
              ? rng.int(warningMaxDays + 1, 400)
              : null;

      const lastPurchaseAt =
        daysSincePurchase === null
          ? null
          : new Date(reference.getTime() - daysSincePurchase * MS_PER_DAY - rng.int(0, 40_000_000)).toISOString();

      // La visita comercial suele preceder o acompanar a la compra.
      const lastVisitAt =
        daysSincePurchase === null
          ? null
          : new Date(
              reference.getTime() - Math.max(0, daysSincePurchase - rng.int(0, 6)) * MS_PER_DAY,
            ).toISOString();

      const totalOrders = bucket === 'never' ? 0 : rng.int(3, 180);

      const primaryLocation: ClientLocation = {
        id: `loc-${String(clientCounter).padStart(4, '0')}-1`,
        clientId: id,
        label: 'Direccion principal',
        addressLine: `${rng.pick(STREET_NAMES)} ${rng.int(120, 9_800)}`,
        communeCode: commune.code,
        communeName: commune.name,
        coordinates,
        coordinateSource: 'external',
        isPrimary: true,
        deliveryRadiusMeters: rng.bool(0.25) ? rng.pick([50, 100, 150]) : null,
      };

      const locations: ClientLocation[] = [primaryLocation];

      // Un subconjunto tiene bodega secundaria: la plataforma debe soportar
      // multiples direcciones de despacho por cliente desde el primer dia.
      if (rng.bool(0.12)) {
        locations.push({
          id: `loc-${String(clientCounter).padStart(4, '0')}-2`,
          clientId: id,
          label: 'Bodega secundaria',
          addressLine: `${rng.pick(STREET_NAMES)} ${rng.int(120, 9_800)}`,
          communeCode: commune.code,
          communeName: commune.name,
          coordinates: sampleNearHub(rng.pick(hubs), commune, rng),
          coordinateSource: 'external',
          isPrimary: false,
          deliveryRadiusMeters: null,
        });
      }

      // Caso real e incomodo: direccion sin geocodificar. Debe generar alerta,
      // no romper el mapa.
      if (rng.bool(0.03)) {
        primaryLocation.coordinates = null;
        primaryLocation.coordinateSource = 'none';
      }

      const client: Client = {
        id,
        code,
        legalName,
        tradeName,
        taxId: buildRut(rng.int(70_000_000, 99_999_999)),
        segment: clientType.segment,
        contactName: `${rng.pick(FIRST_NAMES)} ${rng.pick(LAST_NAMES)}`,
        phone: `+562 2${rng.int(200, 899)} ${rng.int(1000, 9999)}`,
        email: null,
        salesRep: rng.pick(SALES_REPS),
        locations,
        lastPurchaseAt,
        lastVisitAt,
        totalOrders,
        lifetimeValue: totalOrders * rng.int(180_000, 1_400_000),
        createdAt: new Date(reference.getTime() - rng.int(200, 2_400) * MS_PER_DAY).toISOString(),
        active: true,
      };

      client.email = `contacto@${tradeName.toLowerCase().replace(/[^a-z]/g, '')}.cl`;
      clients.push(client);

      // Historial de pedidos: los ultimos 4 de cada cliente, para el detalle.
      const historyCount = Math.min(totalOrders, rng.int(2, 5));
      for (let h = 0; h < historyCount; h += 1) {
        if (!lastPurchaseAt) break;
        orderCounter += 1;
        const createdAt = new Date(
          new Date(lastPurchaseAt).getTime() - h * rng.int(7, 45) * MS_PER_DAY,
        );
        orders.push(
          buildOrder({
            counter: orderCounter,
            client,
            locationId: primaryLocation.id,
            createdAt,
            status: 'entregado',
            rng,
          }),
        );
      }
    }
  }

  return { clients, orders };
}

interface BuildOrderInput {
  counter: number;
  client: Client;
  locationId: string;
  createdAt: Date;
  status: Order['status'];
  rng: SeededRandom;
  /**
   * Volumen maximo del pedido, en litros.
   *
   * Un despachador no emite una guia de 25.000 L para un camion rigido de
   * 10.000 L: dimensiona el pedido al equipo que lo va a servir, o lo divide
   * en varios viajes. Sin este limite, la mitad de la flota no podria cargar
   * ningun pedido y las rutas quedarian vacias.
   */
  maxLiters?: number;
}

/**
 * Genera un pedido de combustible.
 *
 * Un pedido rara vez lleva mas de dos o tres grados: el estanque tiene
 * compartimentos limitados y cada producto ocupa uno completo. El volumen se
 * ajusta al rango habitual de cada grado, porque no se despacha la misma
 * cantidad de petroleo N6 a una industria que de gasolina 97 a una estacion.
 */
function buildOrder(input: BuildOrderInput): Order {
  const { rng } = input;

  // Entre uno y tres grados por pedido, sin repetir producto.
  const grades = rng.sample(FUEL_PRODUCTS, rng.weighted([[1, 52], [2, 33], [3, 15]] as const));
  // Presupuesto por linea cuando el pedido debe caber en un equipo concreto.
  const perLineCap =
    input.maxLiters === undefined ? null : Math.max(500, Math.floor(input.maxLiters / grades.length));

  const lines: OrderLine[] = grades.map((product, index) => {
    const [min, max] = product.typicalOrderLiters;
    const requested = rng.int(min, max);
    const capped = perLineCap === null ? requested : Math.min(requested, perLineCap);
    // Los volumenes se piden en multiplos de 500 L: es como se factura y como
    // se aforan los compartimentos del estanque.
    const liters = Math.max(500, Math.round(capped / 500) * 500);

    return {
      sku: product.sku,
      description: product.name,
      liters,
      pricePerLiter: product.pricePerLiter,
      hazardClass: product.hazardClass,
      compartment: index + 1,
    };
  });

  const totalAmount = lines.reduce((sum, l) => sum + l.liters * l.pricePerLiter, 0);
  const totalLiters = lines.reduce((sum, l) => sum + l.liters, 0);

  // El peso sale del volumen por la densidad de cada grado: es lo que decide
  // si el camion supera el limite legal por eje.
  const totalWeightKg = lines.reduce((sum, line) => {
    const product = FUEL_PRODUCTS.find((p) => p.sku === line.sku);
    return sum + line.liters * (product?.densityKgPerLiter ?? 0.84);
  }, 0);

  const year = input.createdAt.getFullYear();

  return {
    id: asOrderId(`ord-${String(input.counter).padStart(6, '0')}`),
    number: `PED-${year}-${String(input.counter).padStart(6, '0')}`,
    clientId: input.client.id,
    locationId: input.locationId,
    status: input.status,
    createdAt: input.createdAt.toISOString(),
    requestedDeliveryDate: new Date(input.createdAt.getTime() + MS_PER_DAY).toISOString(),
    lines,
    totalAmount,
    totalLiters,
    totalWeightKg: Math.round(totalWeightKg),
    notes: rng.bool(0.22)
      ? rng.pick([
          'Descarga por boca lateral. Coordinar con jefe de patio.',
          'Verificar aforo antes de descargar. Cliente exige guia timbrada.',
          'Acceso restringido despues de las 18:00. Confirmar antes de salir.',
          'Estanque subterraneo. Requiere manguera de 20 m.',
        ])
      : null,
  };
}

interface OperationsBuildResult {
  routes: Route[];
  workOrders: WorkOrder[];
  orders: Order[];
  geofences: Geofence[];
}

/**
 * Construye la operacion del dia: rutas, ordenes de trabajo, pedidos asociados
 * y las geocercas de entrega derivadas de cada direccion de despacho.
 */
function buildDailyOperations(
  rng: SeededRandom,
  reference: Date,
  vehicles: Vehicle[],
  drivers: Driver[],
  clients: Client[],
  orderStartCounter: number,
): OperationsBuildResult {
  const routes: Route[] = [];
  const workOrders: WorkOrder[] = [];
  const orders: Order[] = [];
  const geofences: Geofence[] = [];

  const today = startOfDay(reference);
  const year = today.getFullYear();
  const defaultRadius = DEFAULT_OPERATIONAL_SETTINGS.geofence.defaultRadiusMeters;

  // Geocercas de centros operacionales.
  TERMINALS.forEach((depot, index) => {
    geofences.push({
      id: asGeofenceId(`gf-depot-${index + 1}`),
      name: depot.name,
      description: `Planta de almacenamiento con ${depot.loadingBays} brazos de carga.`,
      kind: 'carga',
      // Radio amplio: un terminal de combustible tiene playa de carga,
      // romana y estacionamiento de espera dentro del mismo recinto.
      geometry: { shape: 'circle', center: { lat: depot.lat, lng: depot.lng }, radiusMeters: 320 },
      referenceId: null,
      clientId: null,
      routeId: null,
      vehicleId: null,
      communeCode: null,
      minDwellSeconds: null,
      rules: {
        // En un terminal interesa la demora en playa de carga, no la entrada.
        triggers: ['entrada', 'salida', 'exceso_tiempo'],
        minDwellSeconds: null,
        maxDwellSeconds: 3_600,
        allowedFrom: null,
        allowedTo: null,
        allowedVehicleIds: [],
        severity: 'warning',
      },
      active: true,
      color: '#0e7490',
      createdAt: today.toISOString(),
      updatedAt: null,
      origin: 'sistema',
    });
  });

  const geocodedClients = clients.filter((c) => c.locations.some((l) => l.coordinates !== null));
  const assigned = new Set<string>();

  let orderCounter = orderStartCounter;
  let workOrderCounter = 0;
  let routeCounter = 0;

  // Solo los vehiculos con equipo GPS entran a la operacion planificada; el
  // resto queda disponible para mostrar el estado "sin telemetria".
  const routableVehicles = vehicles.filter((v) => v.device !== null);

  for (const vehicle of routableVehicles) {
    routeCounter += 1;
    const depot = TERMINALS.find((d) => d.name === vehicle.depotName) ?? TERMINALS[0]!;
    const depotPoint: LatLng = { lat: depot.lat, lng: depot.lng };

    // Zona de trabajo: 1-2 comunas contiguas, lo que hace verificable el
    // control por comuna.
    const primaryCommune = rng.pick(COMMUNES);
    const nearbyCommunes = [...COMMUNES]
      .sort(
        (a, b) =>
          haversineMeters(primaryCommune.center, a.center) -
          haversineMeters(primaryCommune.center, b.center),
      )
      .slice(0, rng.int(2, 3));

    const authorizedCommuneCodes = nearbyCommunes.map((c) => c.code);

    const candidates = geocodedClients.filter(
      (c) =>
        !assigned.has(c.id) &&
        c.locations.some((l) => l.coordinates && authorizedCommuneCodes.includes(l.communeCode)),
    );

    // --- Seleccion de paradas limitada por el estanque -----------------------
    //
    // Un camion cisterna no puede despachar mas litros de los que carga. La
    // ruta se llena mientras quepa producto y se corta al alcanzar el limite,
    // igual que lo haria un planificador de reparto real.
    //
    // Tambien limita los grados distintos al numero de compartimentos: cada
    // producto ocupa uno completo y no pueden mezclarse.
    const usableLiters = Math.floor(vehicle.capacityLiters * TANK_FILL_RATIO);
    const maxStops = rng.int(4, 7);

    const pool = rng.sample(candidates, Math.min(candidates.length, maxStops * 3));
    const planned: { client: Client; location: ClientLocation; coordinates: LatLng; order: Order }[] = [];
    const gradesOnBoard = new Set<string>();
    let loadedLiters = 0;

    for (const client of pool) {
      if (planned.length >= maxStops) break;

      const location =
        client.locations.find(
          (l) => l.coordinates && authorizedCommuneCodes.includes(l.communeCode),
        ) ?? client.locations[0]!;
      if (!location.coordinates) continue;

      orderCounter += 1;
      const order = buildOrder({
        counter: orderCounter,
        client,
        locationId: location.id,
        createdAt: new Date(today.getTime() - MS_PER_DAY),
        status: 'despachado',
        rng,
        // El pedido se dimensiona al reparto que le toca: capacidad util
        // repartida entre las paradas previstas.
        maxLiters: Math.floor(usableLiters / maxStops),
      });

      const gradesAfter = new Set([...gradesOnBoard, ...order.lines.map((l) => l.sku)]);

      // El pedido no cabe: se descarta y se prueba con el siguiente cliente.
      // El contador de pedidos ya avanzo, cosa que es correcta: ese pedido
      // existe, simplemente lo tomara otra ruta u otro dia.
      if (loadedLiters + order.totalLiters > usableLiters) continue;
      if (gradesAfter.size > vehicle.compartments) continue;

      planned.push({ client, location, coordinates: location.coordinates, order });
      loadedLiters += order.totalLiters;
      gradesOnBoard.clear();
      for (const grade of gradesAfter) gradesOnBoard.add(grade);
    }

    if (planned.length < 3) {
      routeCounter -= 1;
      continue;
    }

    planned.forEach((entry) => assigned.add(entry.client.id));

    const ordered = orderByProximity(depotPoint, planned);

    const routeId = asRouteId(`rt-${String(routeCounter).padStart(3, '0')}`);
    const driver = drivers.find((d) => d.id === vehicle.driverId) ?? null;

    // Corredor planificado: base -> paradas -> base.
    //
    // Se prefiere la geometria real por calle precalculada con un servicio de
    // ruteo (`npm run build:rutas`). El trazado sintetico solo actua de
    // respaldo: sirve para que la plataforma funcione sin conexion, pero
    // atraviesa manzanas y no representa un recorrido creible.
    const waypoints: LatLng[] = [depotPoint, ...ordered.map((s) => s.coordinates), depotPoint];

    // El trazado sintetico se construye SIEMPRE, aunque luego se descarte.
    //
    // No es trabajo desperdiciado: `buildLeg` consume el generador
    // pseudoaleatorio. Saltarselo cuando hay geometria en cache desplazaria
    // toda la secuencia posterior y cambiaria los clientes asignados a las
    // rutas siguientes, invalidando la propia cache que se acababa de usar.
    const syntheticPath: LatLng[] = [depotPoint];
    let cursor = depotPoint;
    for (const stop of ordered) {
      syntheticPath.push(...buildLeg(cursor, stop.coordinates, rng));
      cursor = stop.coordinates;
    }
    syntheticPath.push(...buildLeg(cursor, depotPoint, rng));

    const cached = ROUTE_GEOMETRY[`R-${String(routeCounter).padStart(3, '0')}`];
    const cacheHit = cached !== undefined && cached.key === waypointKey(waypoints);

    const plannedPath: LatLng[] = cacheHit
      ? cached.path.map((pair) => ({ lat: pair[1]!, lng: pair[0]! }))
      : syntheticPath;

    const stops: RouteStop[] = [];
    const startHour = rng.int(7, 9);
    let clock = new Date(today);
    clock.setHours(startHour, rng.int(0, 45), 0, 0);
    const routeStartedAt = new Date(clock);

    ordered.forEach((entry, index) => {
      workOrderCounter += 1;

      const travelMinutes = rng.int(18, 42);
      clock = new Date(clock.getTime() + travelMinutes * 60_000);
      const plannedArrival = new Date(clock);
      // La descarga de combustible toma mas que dejar un bulto: conexion de
      // mangueras, aforo y firma de guia.
      clock = new Date(clock.getTime() + rng.int(18, 40) * 60_000);

      const { order } = entry;
      orders.push(order);

      const workOrderId = asWorkOrderId(`wo-${String(workOrderCounter).padStart(6, '0')}`);
      const geofenceId = asGeofenceId(`gf-cli-${String(workOrderCounter).padStart(6, '0')}`);

      geofences.push({
        id: geofenceId,
        name: `${entry.client.tradeName} - entrega`,
        description: `Perimetro de descarga en ${entry.location.addressLine}.`,
        kind: 'cliente',
        geometry: {
          shape: 'circle',
          center: entry.coordinates,
          radiusMeters: entry.location.deliveryRadiusMeters ?? defaultRadius,
        },
        referenceId: entry.client.id,
        clientId: entry.client.id,
        routeId,
        vehicleId: vehicle.id,
        communeCode: entry.location.communeCode,
        minDwellSeconds: DEFAULT_OPERATIONAL_SETTINGS.geofence.minDwellSeconds,
        rules: {
          triggers: ['entrada', 'salida', 'permanencia', 'entrega_detectada'],
          minDwellSeconds: DEFAULT_OPERATIONAL_SETTINGS.geofence.minDwellSeconds,
          maxDwellSeconds: null,
          allowedFrom: null,
          allowedTo: null,
          allowedVehicleIds: [vehicle.id],
          severity: 'info',
        },
        active: true,
        color: '#0d90ae',
        createdAt: today.toISOString(),
        updatedAt: null,
        origin: 'sistema',
      });

      const priority: WorkOrderPriority = rng.weighted([
        ['normal', 62],
        ['alta', 22],
        ['baja', 10],
        ['urgente', 6],
      ] as const);

      const workOrder: WorkOrder = {
        id: workOrderId,
        number: `OT-${year}-${String(workOrderCounter + 1500).padStart(6, '0')}`,
        orderId: order.id,
        orderNumber: order.number,
        clientId: entry.client.id,
        clientName: entry.client.tradeName,
        locationId: entry.location.id,
        addressLine: entry.location.addressLine,
        communeCode: entry.location.communeCode,
        communeName: entry.location.communeName,
        coordinates: entry.coordinates,
        vehicleId: vehicle.id,
        driverId: driver?.id ?? null,
        routeId,
        stopSequence: index + 1,
        scheduledDate: today.toISOString(),
        scheduledWindowStart: plannedArrival.toISOString(),
        scheduledWindowEnd: new Date(plannedArrival.getTime() + 90 * 60_000).toISOString(),
        estimatedArrivalAt: plannedArrival.toISOString(),
        actualArrivalAt: null,
        actualDepartureAt: null,
        priority,
        status: 'asignada',
        geofenceId,
        deliveryConfirmation: 'none',
        closestApproachMeters: null,
        dwellSeconds: null,
        notes: rng.bool(0.18)
          ? rng.pick([
              'Descarga en estanque subterraneo. Verificar aforo previo.',
              'Exigen guia de despacho timbrada al ingresar a la faena.',
              'Playa de carga con acceso unico. Coordinar con porteria.',
              'Cliente solicita medicion de temperatura antes de descargar.',
            ])
          : null,
        trackingToken: `TRK${String(workOrderCounter).padStart(5, '0')}${rng.int(100, 999)}`,
      };

      workOrders.push(workOrder);

      stops.push({
        sequence: index + 1,
        workOrderId,
        clientId: entry.client.id,
        clientName: entry.client.tradeName,
        addressLine: entry.location.addressLine,
        communeName: entry.location.communeName,
        coordinates: entry.coordinates,
        plannedArrivalAt: plannedArrival.toISOString(),
        actualArrivalAt: null,
        status: 'asignada',
      });
    });

    routes.push({
      id: routeId,
      code: `R-${String(routeCounter).padStart(3, '0')}`,
      name: `${nearbyCommunes.map((c) => c.name).join(' / ')}`,
      date: today.toISOString(),
      vehicleId: vehicle.id,
      driverId: driver?.id ?? null,
      status: 'en_curso',
      authorizedCommuneCodes,
      stops,
      plannedPath,
      executedPath: [],
      plannedDistanceKm: cacheHit
        ? cached.distanceKm
        : Math.round((polylineLengthMeters(plannedPath) / 1000) * 10) / 10,
      startedAt: routeStartedAt.toISOString(),
      completedAt: null,
    });
  }

  // Ordenes de trabajo sin asignar: alimentan el KPI de pendientes y la
  // alerta "OT sin camion", que es un problema operacional real.
  const unassignedCount = rng.int(5, 9);
  const unassignedCandidates = geocodedClients.filter((c) => !assigned.has(c.id));

  for (const client of rng.sample(unassignedCandidates, unassignedCount)) {
    workOrderCounter += 1;
    orderCounter += 1;

    const location = client.locations.find((l) => l.isPrimary) ?? client.locations[0]!;
    const order = buildOrder({
      counter: orderCounter,
      client,
      locationId: location.id,
      createdAt: new Date(today.getTime() - rng.int(0, 2) * MS_PER_DAY),
      status: 'confirmado',
      rng,
    });
    orders.push(order);

    const scheduled = new Date(today);
    scheduled.setHours(rng.int(9, 17), rng.pick([0, 15, 30, 45]), 0, 0);

    workOrders.push({
      id: asWorkOrderId(`wo-${String(workOrderCounter).padStart(6, '0')}`),
      number: `OT-${year}-${String(workOrderCounter + 1500).padStart(6, '0')}`,
      orderId: order.id,
      orderNumber: order.number,
      clientId: client.id,
      clientName: client.tradeName,
      locationId: location.id,
      addressLine: location.addressLine,
      communeCode: location.communeCode,
      communeName: location.communeName,
      coordinates: location.coordinates,
      vehicleId: null,
      driverId: null,
      routeId: null,
      stopSequence: null,
      scheduledDate: today.toISOString(),
      scheduledWindowStart: scheduled.toISOString(),
      scheduledWindowEnd: new Date(scheduled.getTime() + 120 * 60_000).toISOString(),
      estimatedArrivalAt: null,
      actualArrivalAt: null,
      actualDepartureAt: null,
      priority: rng.weighted([['normal', 60], ['alta', 30], ['urgente', 10]] as const),
      status: 'pendiente',
      geofenceId: null,
      deliveryConfirmation: 'none',
      closestApproachMeters: null,
      dwellSeconds: null,
      notes: null,
      trackingToken: `TRK${String(workOrderCounter).padStart(5, '0')}${rng.int(100, 999)}`,
    });
  }

  // Historico: OT completadas de dias anteriores, base de los indicadores de
  // tendencia y del historial por cliente.
  for (let dayOffset = 1; dayOffset <= 6; dayOffset += 1) {
    const historicalCount = rng.int(18, 34);
    for (const client of rng.sample(geocodedClients, historicalCount)) {
      workOrderCounter += 1;
      orderCounter += 1;

      const location = client.locations.find((l) => l.isPrimary) ?? client.locations[0]!;
      const day = new Date(today.getTime() - dayOffset * MS_PER_DAY);
      const order = buildOrder({
        counter: orderCounter,
        client,
        locationId: location.id,
        createdAt: day,
        status: 'entregado',
        rng,
      });
      orders.push(order);

      const arrival = new Date(day);
      arrival.setHours(rng.int(8, 18), rng.int(0, 59), 0, 0);
      const departure = new Date(arrival.getTime() + rng.int(6, 28) * 60_000);
      const vehicle = rng.pick(routableVehicles);
      const incident = rng.bool(0.07);

      workOrders.push({
        id: asWorkOrderId(`wo-${String(workOrderCounter).padStart(6, '0')}`),
        number: `OT-${year}-${String(workOrderCounter + 1500).padStart(6, '0')}`,
        orderId: order.id,
        orderNumber: order.number,
        clientId: client.id,
        clientName: client.tradeName,
        locationId: location.id,
        addressLine: location.addressLine,
        communeCode: location.communeCode,
        communeName: location.communeName,
        coordinates: location.coordinates,
        vehicleId: vehicle.id,
        driverId: vehicle.driverId,
        routeId: null,
        stopSequence: null,
        scheduledDate: day.toISOString(),
        scheduledWindowStart: arrival.toISOString(),
        scheduledWindowEnd: new Date(arrival.getTime() + 90 * 60_000).toISOString(),
        estimatedArrivalAt: arrival.toISOString(),
        actualArrivalAt: arrival.toISOString(),
        actualDepartureAt: departure.toISOString(),
        priority: 'normal',
        status: incident ? 'incidencia' : 'completada',
        geofenceId: null,
        deliveryConfirmation: incident ? 'none' : rng.bool(0.7) ? 'gps' : 'manual',
        closestApproachMeters: incident ? null : rng.int(8, 65),
        dwellSeconds: incident ? null : Math.round((departure.getTime() - arrival.getTime()) / 1000),
        notes: incident
          ? rng.pick([
              'Estanque del cliente sin capacidad disponible. Reprogramar.',
              'Faena cerrada al momento de la entrega. Reprogramar.',
              'Acceso bloqueado por obra en la calzada.',
            ])
          : null,
        trackingToken: null,
      });
    }
  }

  // Las comunas NO se duplican como geocercas: su geometria oficial la sirve
  // `AdministrativeBoundaryProvider`. Replicarla aqui anadia varios cientos de
  // kilobytes de poligonos inactivos a cada respuesta del mapa.
  geofences.push({
    id: asGeofenceId('gf-restricted-1'),
    name: 'Zona restringida - Centro historico',
    description:
      'Prohibida la circulacion de camiones con carga peligrosa en horario diurno.',
    kind: 'zona_restringida',
    geometry: { shape: 'circle', center: { lat: -33.4372, lng: -70.6506 }, radiusMeters: 1_400 },
    referenceId: null,
    clientId: null,
    routeId: null,
    vehicleId: null,
    communeCode: '13101',
    minDwellSeconds: null,
    rules: {
      // Entrar ya es la infraccion: no hace falta esperar permanencia.
      triggers: ['entrada', 'entrada_fuera_horario'],
      minDwellSeconds: null,
      maxDwellSeconds: null,
      allowedFrom: '22:00',
      allowedTo: '06:00',
      allowedVehicleIds: [],
      severity: 'critical',
    },
    active: true,
    color: '#dc2626',
    createdAt: today.toISOString(),
    updatedAt: null,
    origin: 'sistema',
  });

  return { routes, workOrders, orders, geofences };
}

// ---------------------------------------------------------------------------
// Composicion
// ---------------------------------------------------------------------------

export interface BuildDatasetOptions {
  seed?: number;
  reference?: Date;
  vehicleCount?: number;
}

export function buildDataset(options: BuildDatasetOptions = {}): DemoDataset {
  const seed = options.seed ?? 20_260_827;
  const reference = options.reference ?? new Date();
  // La cantidad de vehiculos es un parametro, nunca una constante embebida:
  // la plataforma debe escalar sin tocar codigo.
  const vehicleCount = options.vehicleCount ?? 12;

  const rng = new SeededRandom(seed);

  const drivers = buildDrivers(rng, vehicleCount);
  const vehicles = buildVehicles(rng, drivers, vehicleCount);
  const { clients, orders: historicalOrders } = buildClientsAndOrders(rng, reference);

  const daily = buildDailyOperations(
    rng,
    reference,
    vehicles,
    drivers,
    clients,
    historicalOrders.length,
  );

  const orders = [...historicalOrders, ...daily.orders];

  const dataset: DemoDataset = {
    generatedAt: reference.toISOString(),
    seed,
    communes: COMMUNES,
    drivers,
    vehicles,
    clients,
    orders,
    workOrders: daily.workOrders,
    routes: daily.routes,
    geofences: daily.geofences,
    index: {
      clientById: new Map(clients.map((c) => [c.id, c])),
      orderById: new Map(orders.map((o) => [o.id, o])),
      orderByNumber: new Map(orders.map((o) => [o.number.toUpperCase(), o])),
      workOrderById: new Map(daily.workOrders.map((w) => [w.id, w])),
      workOrderByNumber: new Map(daily.workOrders.map((w) => [w.number.toUpperCase(), w])),
      routeById: new Map(daily.routes.map((r) => [r.id, r])),
      vehicleById: new Map(vehicles.map((v) => [v.id, v])),
      driverById: new Map(drivers.map((d) => [d.id, d])),
      geofenceById: new Map(daily.geofences.map((g) => [g.id, g])),
      locationById: new Map(clients.flatMap((c) => c.locations.map((l) => [l.id, l] as const))),
    },
  };

  return dataset;
}

let cachedDataset: DemoDataset | null = null;

/**
 * Instancia unica por proceso. Garantiza que el simulador GPS, el proveedor de
 * operaciones y las rutas de API vean exactamente el mismo mundo.
 */
export function getDataset(): DemoDataset {
  if (!cachedDataset) {
    cachedDataset = buildDataset();
  }
  return cachedDataset;
}

/** Reexportado para el detalle de vehiculo y los encuadres del mapa. */
export { TERMINALS };
