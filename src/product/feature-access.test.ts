import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * El sistema de planes es lo que permite entregar una version Basica limpia
 * cambiando una variable de entorno. Si falla, el cliente ve funciones que no
 * contrato, o peor, se le ocultan funciones que si pago.
 *
 * Los modulos se reimportan en cada caso porque leen `process.env` al
 * evaluarse y Next.js sustituye esas expresiones en compilacion.
 */

const ORIGINAL_ENV = { ...process.env };

async function loadWith(env: Record<string, string>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return {
    access: await import('@/product/feature-access'),
    plans: await import('@/product/plans'),
  };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.resetModules();
});

describe('planIncludes', () => {
  it('cada plan incluye lo del anterior', async () => {
    const { plans } = await loadWith({});

    expect(plans.planIncludes('advanced', 'base')).toBe(true);
    expect(plans.planIncludes('advanced', 'medium')).toBe(true);
    expect(plans.planIncludes('medium', 'base')).toBe(true);
    expect(plans.planIncludes('medium', 'medium')).toBe(true);
  });

  it('un plan inferior no cubre a uno superior', async () => {
    const { plans } = await loadWith({});

    expect(plans.planIncludes('base', 'medium')).toBe(false);
    expect(plans.planIncludes('base', 'advanced')).toBe(false);
    expect(plans.planIncludes('medium', 'advanced')).toBe(false);
  });
});

describe('Plan Basico contratado', () => {
  const env = { NEXT_PUBLIC_PRODUCT_PLAN: 'base', NEXT_PUBLIC_SHOW_UPSELL: 'true' };

  it('mantiene disponibles todas las funciones Base', async () => {
    const { access } = await loadWith(env);

    for (const id of [
      'dashboard',
      'operational-map',
      'fleet-tracking',
      'client-portfolio',
      'dormant-clients',
      'work-orders',
      'routes',
      'geofences',
      'geofence-editor',
      'alerts',
      'territory-intelligence',
      'heatmap',
      'public-tracking',
      'operational-settings',
    ] as const) {
      expect(access.hasFeature(id), `${id} deberia estar disponible en Base`).toBe(true);
    }
  });

  it('NO permite usar funciones del Plan Medio', async () => {
    const { access } = await loadWith(env);

    expect(access.hasFeature('control-tower')).toBe(false);
    expect(access.hasFeature('driver-portal')).toBe(false);
    expect(access.hasFeature('proof-of-delivery')).toBe(false);
    expect(access.hasFeature('route-replay')).toBe(false);
  });

  it('NO permite usar funciones del Plan Avanzado', async () => {
    const { access } = await loadWith(env);

    expect(access.hasFeature('smart-dispatch')).toBe(false);
    expect(access.hasFeature('operational-ai')).toBe(false);
  });

  it('anuncia Medio y Avanzado como mejora cuando la venta cruzada esta activa', async () => {
    const { access } = await loadWith(env);

    expect(access.resolveFeature('control-tower').showsAsUpgrade).toBe(true);
    expect(access.resolveFeature('smart-dispatch').showsAsUpgrade).toBe(true);
  });
});

describe('Plan Basico sin venta cruzada', () => {
  const env = { NEXT_PUBLIC_PRODUCT_PLAN: 'base', NEXT_PUBLIC_SHOW_UPSELL: 'false' };

  it('hace desaparecer por completo Medio y Avanzado', async () => {
    const { access } = await loadWith(env);

    // Esta es la garantia que permite entregar una version Basica limpia sin
    // revisar decenas de componentes a mano.
    expect(access.isFeatureVisible('control-tower')).toBe(false);
    expect(access.isFeatureVisible('driver-portal')).toBe(false);
    expect(access.isFeatureVisible('smart-dispatch')).toBe(false);
    expect(access.isFeatureVisible('operational-ai')).toBe(false);
  });

  it('no deja ninguna funcion de plan superior visible', async () => {
    const { access } = await loadWith(env);

    const superiores = access
      .getVisibleFeatures()
      .filter((a) => a.feature.minimumPlan !== 'base');

    expect(superiores).toHaveLength(0);
  });

  it('conserva intactas las funciones Base', async () => {
    const { access } = await loadWith(env);

    expect(access.isFeatureVisible('operational-map')).toBe(true);
    expect(access.hasFeature('geofence-editor')).toBe(true);
  });

  it('declara bloqueadas las rutas de planes superiores', async () => {
    const { access } = await loadWith(env);
    const bloqueadas = access.getBlockedRoutes();

    expect(bloqueadas).toContain('/control');
    expect(bloqueadas).toContain('/despachos');
    // El portal del conductor no es una pantalla del menu, pero declara ruta
    // justamente para que el plan Basico la bloquee por URL igual que el resto.
    expect(bloqueadas).toContain('/conductor');
    expect(bloqueadas).not.toContain('/mapa');
  });

  it('no ofrece el portal del conductor ni su evidencia', async () => {
    const { access } = await loadWith(env);

    expect(access.hasFeature('driver-portal')).toBe(false);
    expect(access.isFeatureVisible('driver-portal')).toBe(false);
    expect(access.hasFeature('proof-of-delivery')).toBe(false);
  });
});

describe('Plan Medio contratado', () => {
  const env = { NEXT_PUBLIC_PRODUCT_PLAN: 'medium', NEXT_PUBLIC_SHOW_UPSELL: 'true' };

  it('mantiene todo lo Base disponible', async () => {
    const { access } = await loadWith(env);

    expect(access.hasFeature('operational-map')).toBe(true);
    expect(access.hasFeature('geofence-editor')).toBe(true);
    expect(access.hasFeature('territory-intelligence')).toBe(true);
  });

  it('habilita las funciones Medio ya implementadas', async () => {
    const { access } = await loadWith(env);

    for (const id of [
      'control-tower',
      'vehicle-operational-panel',
      'route-replay',
      'route-control',
      'dispatch-board',
      'delivery-detection',
      'driver-portal',
      'proof-of-delivery',
      'command-palette',
    ] as const) {
      expect(access.hasFeature(id), `${id} deberia estar disponible en Medio`).toBe(true);
    }
  });

  it('incluye en el plan las funciones Medio que esperan proveedor, pero no las declara usables', async () => {
    const { access } = await loadWith(env);
    const traffic = access.resolveFeature('live-traffic');

    // Distincion deliberada: pertenece al plan, pero sin proveedor no opera.
    // Declararla usable seria prometer trafico real que no existe.
    expect(traffic.includedInPlan).toBe(true);
    expect(traffic.usable).toBe(false);
    expect(traffic.state).toBe('requires-provider');
    expect(traffic.visible).toBe(true);
  });

  it('mantiene bloqueado el Plan Avanzado', async () => {
    const { access } = await loadWith(env);

    expect(access.hasFeature('smart-dispatch')).toBe(false);
    expect(access.resolveFeature('map-3d').state).toBe('locked');
  });
});

describe('Plan Medio sin venta cruzada', () => {
  it('elimina el Avanzado y conserva Base y Medio', async () => {
    const { access } = await loadWith({
      NEXT_PUBLIC_PRODUCT_PLAN: 'medium',
      NEXT_PUBLIC_SHOW_UPSELL: 'false',
    });

    expect(access.isFeatureVisible('smart-dispatch')).toBe(false);
    expect(access.isFeatureVisible('map-3d')).toBe(false);
    expect(access.isFeatureVisible('control-tower')).toBe(true);
    expect(access.isFeatureVisible('operational-map')).toBe(true);
  });
});

describe('Plan Avanzado contratado', () => {
  it('habilita lo implementado y deja pendiente lo que espera datos o proveedor', async () => {
    const { access } = await loadWith({ NEXT_PUBLIC_PRODUCT_PLAN: 'advanced' });

    expect(access.hasFeature('control-tower')).toBe(true);

    // `ready` significa implementado a la espera de datos reales: se ve, pero
    // no se declara operativo.
    const dispatch = access.resolveFeature('smart-dispatch');
    expect(dispatch.includedInPlan).toBe(true);
    expect(dispatch.usable).toBe(false);
    expect(dispatch.state).toBe('ready');

    const ai = access.resolveFeature('operational-ai');
    expect(ai.state).toBe('requires-provider');
  });

  it('no deja ninguna ruta bloqueada', async () => {
    const { access } = await loadWith({ NEXT_PUBLIC_PRODUCT_PLAN: 'advanced' });
    expect(access.getBlockedRoutes()).toHaveLength(0);
  });
});

describe('configuracion de producto', () => {
  it('cae a Plan Medio ante un valor desconocido', async () => {
    const { plans } = await loadWith({ NEXT_PUBLIC_PRODUCT_PLAN: 'enterprise' });
    expect(plans.getProductConfig().plan).toBe('medium');
  });

  it('interpreta los indicadores booleanos', async () => {
    const { plans } = await loadWith({
      NEXT_PUBLIC_SHOW_UPSELL: 'false',
      NEXT_PUBLIC_SHOW_PLAN_BADGES: 'true',
      NEXT_PUBLIC_DEMO_MODE: 'false',
    });

    const config = plans.getProductConfig();
    expect(config.showUpsell).toBe(false);
    expect(config.showPlanBadges).toBe(true);
    expect(config.demoMode).toBe(false);
  });
});

describe('coherencia del catalogo', () => {
  it('toda funcion con ruta declara un plan minimo valido', async () => {
    const { plans } = await loadWith({});
    const { FEATURES } = await import('@/product/features');

    for (const feature of FEATURES) {
      expect(plans.PLAN_ORDER).toContain(feature.minimumPlan);
    }
  });

  it('ninguna funcion Base se anuncia como mejora', async () => {
    await loadWith({});
    const { FEATURES } = await import('@/product/features');

    const base = FEATURES.filter((f) => f.minimumPlan === 'base');
    expect(base.every((f) => f.showAsUpgrade !== true)).toBe(true);
  });

  it('no hay identificadores repetidos', async () => {
    await loadWith({});
    const { FEATURES } = await import('@/product/features');

    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length);
  });
});
