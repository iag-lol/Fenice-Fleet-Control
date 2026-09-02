/**
 * Planes comerciales de Fenice Fleet Control.
 *
 * Este modulo es ISOMORFICO y no contiene secretos: lo leen tanto el servidor
 * como el navegador para decidir que se muestra y que se ejecuta.
 */

export type ProductPlan = 'base' | 'medium' | 'advanced';

/** Orden de inclusion: cada plan contiene todo lo del anterior. */
export const PLAN_ORDER: readonly ProductPlan[] = ['base', 'medium', 'advanced'];

export const PLAN_LABEL: Record<ProductPlan, string> = {
  base: 'Plan Basico',
  medium: 'Plan Medio',
  advanced: 'Plan Avanzado',
};

export const PLAN_SHORT_LABEL: Record<ProductPlan, string> = {
  base: 'Basico',
  medium: 'Medio',
  advanced: 'Avanzado',
};

/** `true` si `plan` cubre lo que exige `minimum`. */
export function planIncludes(plan: ProductPlan, minimum: ProductPlan): boolean {
  return PLAN_ORDER.indexOf(plan) >= PLAN_ORDER.indexOf(minimum);
}

/**
 * Estado de implementacion de una funcionalidad.
 *
 * Separar el PLAN de la IMPLEMENTACION evita el peor defecto de un producto
 * por niveles: mostrar como disponible algo que en realidad no funciona.
 *
 *  - `active`            operativa aqui y ahora.
 *  - `ready`             implementada, a la espera de datos reales.
 *  - `requires-provider` implementada, necesita credenciales de un tercero.
 *  - `locked`            pertenece a un plan superior al contratado.
 */
export type FeatureImplementationState =
  | 'active'
  | 'ready'
  | 'requires-provider'
  | 'locked';

export const IMPLEMENTATION_LABEL: Record<FeatureImplementationState, string> = {
  active: 'Disponible',
  ready: 'Lista para conectar',
  'requires-provider': 'Requiere proveedor configurado',
  locked: 'Disponible al ampliar el plan',
};

export interface ProductConfig {
  /** Plan contratado. Determina que se puede usar. */
  plan: ProductPlan;
  /** Mostrar la etiqueta de plan junto a las funciones. */
  showPlanBadges: boolean;
  /** Mostrar las funciones de planes superiores como oportunidad de mejora. */
  showUpsell: boolean;
  /** Los datos provienen del dataset de demostracion. */
  demoMode: boolean;
}

const TRUE_VALUES = new Set(['true', '1', 'yes', 'si']);

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return TRUE_VALUES.has(value.trim().toLowerCase());
}

function readPlan(value: string | undefined): ProductPlan {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'base' || normalized === 'medium' || normalized === 'advanced'
    ? normalized
    : 'medium';
}

/**
 * Configuracion de producto vigente.
 *
 * Las variables llevan el prefijo `NEXT_PUBLIC_` porque el navegador necesita
 * saber que mostrar. No es informacion sensible: el control real de acceso a
 * los datos vive en el servidor, no en la visibilidad de un boton.
 *
 * Se leen con acceso literal a `process.env` porque Next.js sustituye estas
 * expresiones en tiempo de compilacion; un acceso dinamico no se sustituiria.
 */
export function getProductConfig(): ProductConfig {
  const plan = readPlan(process.env.NEXT_PUBLIC_PRODUCT_PLAN);

  return {
    plan,
    showPlanBadges: readBoolean(process.env.NEXT_PUBLIC_SHOW_PLAN_BADGES, true),
    // Sin venta cruzada no tiene sentido anunciar el plan de cada funcion.
    showUpsell: readBoolean(process.env.NEXT_PUBLIC_SHOW_UPSELL, true),
    // Produccion por defecto. La demostracion se pide de forma explicita.
    demoMode: readBoolean(process.env.NEXT_PUBLIC_DEMO_MODE, false),
  };
}
