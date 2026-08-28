/**
 * Generador pseudoaleatorio determinista (mulberry32).
 *
 * El dataset de demostracion DEBE ser identico en cada arranque del proceso y
 * entre servidor y cliente: de lo contrario el mapa, los KPIs y las tablas
 * mostrarian cifras distintas en cada render y la demo perderia credibilidad.
 */
export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Flotante en [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Flotante en [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Entero en [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('SeededRandom.pick: coleccion vacia');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Elige `count` elementos distintos preservando determinismo. */
  sample<T>(items: readonly T[], count: number): T[] {
    const pool = [...items];
    const result: T[] = [];
    const take = Math.min(count, pool.length);
    for (let i = 0; i < take; i += 1) {
      const index = Math.floor(this.next() * pool.length);
      result.push(pool.splice(index, 1)[0]!);
    }
    return result;
  }

  /** Elige segun pesos relativos. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
    let threshold = this.next() * total;
    for (const [value, weight] of entries) {
      threshold -= weight;
      if (threshold <= 0) return value;
    }
    return entries[entries.length - 1]![0];
  }

  /** Muestra de una normal (Box-Muller), acotada a [min, max]. */
  normal(mean: number, stdDev: number, min: number, max: number): number {
    const u1 = Math.max(Number.EPSILON, this.next());
    const u2 = this.next();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(min, Math.min(max, mean + z * stdDev));
  }
}
