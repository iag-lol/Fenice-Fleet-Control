/**
 * Vocabulario del dataset de demostracion.
 *
 * DOMINIO: distribucion de combustible. Fenice despacha diesel, gasolinas,
 * kerosene y petroleo combustible desde plantas de almacenamiento hacia
 * estaciones de servicio, faenas mineras, empresas de transporte, agricolas y
 * plantas industriales.
 *
 * Esto no es decoracion: el combustible se mide en LITROS, se transporta en
 * camiones CISTERNA con compartimentos, y la operacion tiene restricciones
 * (carga peligrosa, guia de despacho, capacidad por compartimento) que no
 * existen en una distribucion de abarrotes.
 */

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export type FuelGrade =
  | 'diesel'
  | 'gasolina_93'
  | 'gasolina_95'
  | 'gasolina_97'
  | 'kerosene'
  | 'petroleo_combustible'
  | 'adblue';

export interface FuelProduct {
  code: FuelGrade;
  sku: string;
  name: string;
  /** Precio referencial por litro en CLP. */
  pricePerLiter: number;
  /** Densidad en kg/L: determina el peso real de la carga. */
  densityKgPerLiter: number;
  /** Clasificacion de sustancia peligrosa segun NCh 382. */
  hazardClass: string;
  /** Volumen habitual de un pedido, en litros. */
  typicalOrderLiters: [number, number];
}

export const FUEL_PRODUCTS: readonly FuelProduct[] = [
  {
    code: 'diesel',
    sku: 'FEN-DIE-B',
    name: 'Petroleo Diesel B',
    pricePerLiter: 1_089,
    densityKgPerLiter: 0.84,
    hazardClass: 'Clase 3 · UN 1202',
    typicalOrderLiters: [3_000, 25_000],
  },
  {
    code: 'gasolina_93',
    sku: 'FEN-G93',
    name: 'Gasolina 93 octanos',
    pricePerLiter: 1_284,
    densityKgPerLiter: 0.75,
    hazardClass: 'Clase 3 · UN 1203',
    typicalOrderLiters: [2_000, 15_000],
  },
  {
    code: 'gasolina_95',
    sku: 'FEN-G95',
    name: 'Gasolina 95 octanos',
    pricePerLiter: 1_356,
    densityKgPerLiter: 0.75,
    hazardClass: 'Clase 3 · UN 1203',
    typicalOrderLiters: [2_000, 12_000],
  },
  {
    code: 'gasolina_97',
    sku: 'FEN-G97',
    name: 'Gasolina 97 octanos',
    pricePerLiter: 1_421,
    densityKgPerLiter: 0.75,
    hazardClass: 'Clase 3 · UN 1203',
    typicalOrderLiters: [1_000, 8_000],
  },
  {
    code: 'kerosene',
    sku: 'FEN-KER',
    name: 'Kerosene domestico',
    pricePerLiter: 962,
    densityKgPerLiter: 0.8,
    hazardClass: 'Clase 3 · UN 1223',
    typicalOrderLiters: [1_000, 6_000],
  },
  {
    code: 'petroleo_combustible',
    sku: 'FEN-PC6',
    name: 'Petroleo combustible N6',
    pricePerLiter: 748,
    densityKgPerLiter: 0.95,
    hazardClass: 'Clase 3 · UN 1202',
    typicalOrderLiters: [8_000, 30_000],
  },
  {
    code: 'adblue',
    sku: 'FEN-ADB',
    name: 'AdBlue (urea automotriz)',
    pricePerLiter: 596,
    densityKgPerLiter: 1.09,
    hazardClass: 'No peligroso',
    typicalOrderLiters: [500, 4_000],
  },
];

export const FUEL_LABEL: Record<FuelGrade, string> = {
  diesel: 'Diesel B',
  gasolina_93: 'Gasolina 93',
  gasolina_95: 'Gasolina 95',
  gasolina_97: 'Gasolina 97',
  kerosene: 'Kerosene',
  petroleo_combustible: 'Petroleo N6',
  adblue: 'AdBlue',
};

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

/** Tipos de cliente reales de una distribuidora de combustible. */
export const CLIENT_TYPES = [
  { kind: 'Estacion de Servicio', segment: 'estacion_servicio' as const, weight: 34 },
  { kind: 'Transportes', segment: 'transporte' as const, weight: 18 },
  { kind: 'Constructora', segment: 'constructora' as const, weight: 13 },
  { kind: 'Agricola', segment: 'agricola' as const, weight: 12 },
  { kind: 'Planta Industrial', segment: 'industrial' as const, weight: 10 },
  { kind: 'Aridos y Minería', segment: 'minero' as const, weight: 7 },
  { kind: 'Pesquera', segment: 'pesquera' as const, weight: 3 },
  { kind: 'Generadora', segment: 'generadora' as const, weight: 3 },
] as const;

export const COMPANY_ROOTS = [
  'Andina', 'Del Valle', 'San Martin', 'Cordillera', 'Pacifico', 'Austral',
  'Aconcagua', 'Maipo', 'Los Robles', 'El Trebol', 'Santa Elena', 'Rio Claro',
  'Bio Bio', 'Casablanca', 'Los Andes', 'Curico', 'Vina Nueva', 'La Serena',
  'Portillo', 'Nevados', 'Chacabuco', 'Renacer', 'Altamira', 'Tres Puentes',
  'Litoral', 'Mistral', 'Domeyko', 'Huelen', 'Manquehue', 'Talagante',
  'Melipilla', 'Colchagua', 'Rapel', 'Coihue', 'Quillota', 'Petorca',
  'Limari', 'Elqui', 'Choapa', 'Huasco', 'Chena', 'Lonquen', 'Peuco',
] as const;

export const COMPANY_SUFFIXES = ['SpA', 'Ltda.', 'S.A.', 'y Cia. Ltda.', 'EIRL'] as const;

export const STREET_NAMES = [
  'Av. Vicuna Mackenna', 'Av. Libertador Bernardo O’Higgins', 'Av. Providencia',
  'Av. Apoquindo', 'Av. Kennedy', 'Av. Las Condes', 'Av. Grecia', 'Av. Macul',
  'Av. Departamental', 'Av. Pajaritos', 'Av. Americo Vespucio', 'Av. Independencia',
  'Av. Recoleta', 'Av. La Florida', 'Av. Vitacura', 'Av. El Bosque', 'Av. Matta',
  'Av. Santa Rosa', 'Av. San Pablo', 'Av. Gran Avenida', 'Camino Lo Echevers',
  'Av. Presidente Riesco', 'Av. Manuel Antonio Matta', 'Av. Los Leones',
  'Av. Salvador', 'Av. Irarrazaval', 'Av. Egana', 'Av. Tobalaba', 'Av. Colon',
  'Camino Internacional', 'Av. Portales', 'Av. Carrascal', 'Av. Einstein',
  'Av. Fermin Vivaceta', 'Av. Ossa', 'Av. Larrain', 'Av. Quilin', 'Av. Lo Ovalle',
  'Av. Los Pajaritos', 'Ruta 5 Sur', 'Panamericana Norte', 'Camino Melipilla',
  'Camino a Lonquen', 'Ruta 68', 'Ruta 78', 'Camino Padre Hurtado',
] as const;

export const FIRST_NAMES = [
  'Carlos', 'Miguel', 'Jorge', 'Luis', 'Pedro', 'Andres', 'Rodrigo', 'Cristian',
  'Sebastian', 'Patricio', 'Francisco', 'Marcelo', 'Hernan', 'Ricardo', 'Ivan',
  'Claudia', 'Marcela', 'Paulina', 'Carolina', 'Andrea', 'Veronica', 'Daniela',
  'Fernanda', 'Camila', 'Javiera', 'Rosa', 'Ximena', 'Gabriela', 'Nicolas',
  'Matias', 'Felipe', 'Gonzalo', 'Alejandro', 'Manuel', 'Roberto', 'Victor',
] as const;

export const LAST_NAMES = [
  'Gonzalez', 'Munoz', 'Rojas', 'Diaz', 'Perez', 'Soto', 'Contreras', 'Silva',
  'Martinez', 'Sepulveda', 'Morales', 'Rodriguez', 'Lopez', 'Fuentes', 'Hernandez',
  'Torres', 'Araya', 'Flores', 'Espinoza', 'Valenzuela', 'Castillo', 'Tapia',
  'Reyes', 'Gutierrez', 'Castro', 'Vargas', 'Alvarez', 'Vasquez', 'Sanchez',
  'Fernandez', 'Ramirez', 'Carrasco', 'Godoy', 'Vergara', 'Riquelme', 'Cortes',
] as const;

export const SALES_REPS = [
  'Marcela Fuentes', 'Rodrigo Alarcon', 'Paulina Vidal', 'Hernan Cabrera',
  'Carolina Pizarro', 'Ignacio Bravo', 'Daniela Nunez', 'Esteban Fritz',
] as const;

// ---------------------------------------------------------------------------
// Flota cisterna
// ---------------------------------------------------------------------------

export interface TankerSpec {
  brand: string;
  model: string;
  type: 'cisterna_rigido' | 'cisterna_semirremolque' | 'camioneta_estanque';
  /** Capacidad total del estanque, en litros. */
  capacityLiters: number;
  /**
   * Compartimentos del estanque.
   *
   * Un camion cisterna no lleva un unico deposito: se divide para transportar
   * varios productos en el mismo viaje sin mezclarlos. Condiciona que pedidos
   * puede agrupar una misma ruta.
   */
  compartments: number;
}

export const TANKER_MODELS: readonly TankerSpec[] = [
  { brand: 'Mercedes-Benz', model: 'Actros 2645', type: 'cisterna_semirremolque', capacityLiters: 39_000, compartments: 5 },
  { brand: 'Volvo', model: 'FH 460 6x4', type: 'cisterna_semirremolque', capacityLiters: 42_000, compartments: 6 },
  { brand: 'Scania', model: 'R 450 A6x4', type: 'cisterna_semirremolque', capacityLiters: 38_000, compartments: 5 },
  { brand: 'Freightliner', model: 'Cascadia 6x4', type: 'cisterna_semirremolque', capacityLiters: 45_000, compartments: 6 },
  { brand: 'Mercedes-Benz', model: 'Atego 1725', type: 'cisterna_rigido', capacityLiters: 14_000, compartments: 4 },
  { brand: 'Volvo', model: 'FL 240', type: 'cisterna_rigido', capacityLiters: 16_000, compartments: 4 },
  { brand: 'International', model: 'DuraStar 4400', type: 'cisterna_rigido', capacityLiters: 12_000, compartments: 3 },
  { brand: 'Hino', model: 'FG 1725', type: 'cisterna_rigido', capacityLiters: 10_000, compartments: 3 },
  { brand: 'Ford', model: 'Cargo 1723', type: 'cisterna_rigido', capacityLiters: 11_000, compartments: 3 },
  { brand: 'Iveco', model: 'Tector 170E22', type: 'cisterna_rigido', capacityLiters: 9_000, compartments: 2 },
  { brand: 'Chevrolet', model: 'NPR 816 estanque', type: 'camioneta_estanque', capacityLiters: 3_000, compartments: 1 },
  { brand: 'Hyundai', model: 'HD78 estanque', type: 'camioneta_estanque', capacityLiters: 2_500, compartments: 1 },
];

/**
 * Plantas de almacenamiento desde las que sale el producto.
 *
 * En distribucion de combustible el origen no es una bodega cualquiera: es un
 * terminal con capacidad de carga por brazo y control de aforo.
 */
export const TERMINALS = [
  { name: 'Terminal Quilicura', lat: -33.3652, lng: -70.7231, loadingBays: 6 },
  { name: 'Planta Maipu', lat: -33.4971, lng: -70.7589, loadingBays: 4 },
  { name: 'Terminal San Bernardo', lat: -33.5884, lng: -70.7041, loadingBays: 5 },
] as const;

// ---------------------------------------------------------------------------
// Identificadores chilenos
// ---------------------------------------------------------------------------

/** Genera un RUT chileno con digito verificador valido. */
export function buildRut(base: number): string {
  const digits = String(base).split('').reverse();
  let sum = 0;
  let multiplier = 2;

  for (const digit of digits) {
    sum += Number(digit) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const verifier = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  const formatted = String(base).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formatted}-${verifier}`;
}

/** Patente chilena moderna: 4 letras + 2 digitos. */
export function buildPlate(index: number): string {
  const consonants = 'BCDFGHJKLPRSTVWXYZ';
  const a = consonants[index % consonants.length]!;
  const b = consonants[(index * 7 + 3) % consonants.length]!;
  const c = consonants[(index * 13 + 5) % consonants.length]!;
  const d = consonants[(index * 5 + 11) % consonants.length]!;
  const number = String(10 + ((index * 17) % 90)).padStart(2, '0');
  return `${a}${b}${c}${d}${number}`;
}
