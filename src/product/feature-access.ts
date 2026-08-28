import {
  FEATURES,
  getFeature,
  type FeatureDefinition,
  type FeatureId,
} from '@/product/features';
import {
  getProductConfig,
  planIncludes,
  type FeatureImplementationState,
  type ProductPlan,
} from '@/product/plans';

/**
 * Resolucion de acceso a funcionalidades.
 *
 * Punto UNICO donde se decide si una funcion se puede usar, si se anuncia
 * como mejora o si desaparece por completo. Ningun componente compara planes
 * por su cuenta.
 */

export interface FeatureAccess {
  feature: FeatureDefinition;
  /** El plan contratado cubre la funcion. */
  includedInPlan: boolean;
  /** Se puede usar aqui y ahora. */
  usable: boolean;
  /** Estado efectivo, ya combinado plan + implementacion. */
  state: FeatureImplementationState;
  /** Debe aparecer en la interfaz, sea usable o como oportunidad de mejora. */
  visible: boolean;
  /** Se muestra bloqueada, invitando a ampliar el plan. */
  showsAsUpgrade: boolean;
  /** Plan minimo que la incluye. */
  requiredPlan: ProductPlan;
  /** Motivo por el que no es usable, listo para mostrar al operador. */
  reason: string | null;
}

/**
 * Estado y visibilidad de una funcion.
 *
 * Reglas, en este orden:
 *  1. Si el plan no la cubre y la venta cruzada esta desactivada, no existe.
 *  2. Si el plan no la cubre y si hay venta cruzada, se ve bloqueada.
 *  3. Si el plan la cubre pero le falta un proveedor, se ve pero no opera.
 *  4. Si el plan la cubre y esta implementada, es usable.
 */
export function resolveFeature(id: FeatureId): FeatureAccess {
  const config = getProductConfig();
  const feature = getFeature(id);
  const includedInPlan = planIncludes(config.plan, feature.minimumPlan);

  if (!includedInPlan) {
    const showsAsUpgrade = config.showUpsell && feature.showAsUpgrade === true;

    return {
      feature,
      includedInPlan: false,
      usable: false,
      state: 'locked',
      // Sin venta cruzada la funcion desaparece por completo: es lo que
      // permite entregar una version Basica limpia cambiando una variable.
      visible: showsAsUpgrade,
      showsAsUpgrade,
      requiredPlan: feature.minimumPlan,
      reason: `Disponible en ${feature.minimumPlan === 'advanced' ? 'Plan Avanzado' : 'Plan Medio'}.`,
    };
  }

  const needsProvider = feature.implementationState === 'requires-provider';
  const notReady = feature.implementationState === 'ready';

  return {
    feature,
    includedInPlan: true,
    usable: feature.implementationState === 'active',
    state: feature.implementationState,
    visible: true,
    showsAsUpgrade: false,
    requiredPlan: feature.minimumPlan,
    reason: needsProvider
      ? 'Requiere configurar el proveedor correspondiente.'
      : notReady
        ? 'Disponible al conectar la fuente de datos definitiva.'
        : null,
  };
}

/** `true` si la funcion se puede usar ahora mismo. */
export function hasFeature(id: FeatureId): boolean {
  return resolveFeature(id).usable;
}

/** Alias explicito para los puntos donde se lee mejor la intencion. */
export function canUseFeature(id: FeatureId): boolean {
  return hasFeature(id);
}

/** `true` si la funcion debe aparecer en la interfaz, usable o no. */
export function isFeatureVisible(id: FeatureId): boolean {
  return resolveFeature(id).visible;
}

/** Plan minimo que incluye la funcion. */
export function getFeaturePlan(id: FeatureId): ProductPlan {
  return getFeature(id).minimumPlan;
}

/** Todas las funciones visibles, para las pantallas de catalogo y navegacion. */
export function getVisibleFeatures(): FeatureAccess[] {
  return FEATURES.map((f) => resolveFeature(f.id)).filter((a) => a.visible);
}

/** Funciones usables que declaran ruta y piden aparecer en el menu. */
export function getNavigableFeatures(): FeatureAccess[] {
  return getVisibleFeatures().filter(
    (a) => a.feature.showInNavigation === true && a.feature.route !== undefined,
  );
}

/**
 * Rutas que el plan contratado NO cubre.
 *
 * Las usa el middleware para no dejar accesible por URL una pantalla que la
 * interfaz ya oculto: esconder el enlace no es control de acceso.
 */
export function getBlockedRoutes(): string[] {
  return FEATURES.filter((f) => f.route !== undefined && !resolveFeature(f.id).includedInPlan)
    .map((f) => f.route!)
    .filter((route) => route !== '/');
}
