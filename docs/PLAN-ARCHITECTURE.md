# Arquitectura de planes

Cómo Fenice Fleet Control separa Plan Básico, Plan Medio y Plan Avanzado, y
cómo entregar al cliente exactamente lo que contrató.

## El problema que resuelve

Un producto por niveles se degrada de dos formas: se filtran funciones que el
cliente no pagó, o se esconde mal lo que sí pagó. Ambas nacen del mismo error
— repartir `if (plan === 'medium')` por la aplicación.

Aquí la decisión vive en un solo sitio.

## Las tres piezas

| Archivo | Responsabilidad |
|---|---|
| [`src/product/plans.ts`](../src/product/plans.ts) | Qué planes existen y qué incluye cada uno |
| [`src/product/features.ts`](../src/product/features.ts) | Catálogo de funcionalidades |
| [`src/product/feature-access.ts`](../src/product/feature-access.ts) | Única resolución de acceso |

Ningún componente compara planes. Todos preguntan:

```ts
hasFeature('control-tower')        // ¿se puede usar ahora?
isFeatureVisible('smart-dispatch') // ¿debe aparecer, aunque bloqueada?
resolveFeature('live-traffic')     // estado completo y motivo
```

## Plan ≠ implementación

Separar ambos ejes evita el peor defecto de un producto por niveles: presentar
como disponible algo que no funciona.

| Estado | Significado |
|---|---|
| `active` | Operativa aquí y ahora |
| `ready` | Implementada, a la espera de datos reales |
| `requires-provider` | Implementada, necesita credenciales de un tercero |
| `locked` | Pertenece a un plan superior al contratado |

Ejemplo real: **Tráfico en tiempo real** pertenece al Plan Medio. Con el plan
contratado está `includedInPlan: true`, pero sin `TRAFFIC_PROVIDER` queda
`usable: false` y la interfaz dice que requiere proveedor. Nunca se inventa
tráfico.

## Entregar una versión al cliente

```bash
# Cliente que contrató el Básico
NEXT_PUBLIC_PRODUCT_PLAN=base
NEXT_PUBLIC_SHOW_UPSELL=false
```

Desaparecen: Torre de control, Despachos, portal del conductor, evidencia,
replay, todas las previsualizaciones del Avanzado, los distintivos de plan y
los textos promocionales.

```bash
# Cliente que contrató el Medio
NEXT_PUBLIC_PRODUCT_PLAN=medium
NEXT_PUBLIC_SHOW_UPSELL=false
```

Desaparece únicamente el Avanzado.

**Requiere compilación limpia.** Las variables `NEXT_PUBLIC_*` se incrustan en
el bundle del navegador durante la compilación, y Next.js reutiliza artefactos
en caché aunque cambien:

```bash
rm -rf .next && npm run build
```

## Tres capas de aplicación

Ocultar un enlace no es control de acceso. El sistema actúa en tres niveles:

1. **Navegación** — [`getVisibleNavGroups()`](../src/components/shell/navigation.ts)
   filtra el menú lateral y la barra móvil.
2. **Rutas** — [`src/middleware.ts`](../src/middleware.ts) devuelve un **404
   real** para las pantallas que el plan no incluye, antes de renderizar.
   Se resuelve desde el mismo catálogo: no hay una segunda lista que mantener.
3. **Componentes** — `FeatureGate` y `UpgradeAction` deciden qué se muestra
   dentro de una pantalla.

Verificado: con `NEXT_PUBLIC_PRODUCT_PLAN=base`, `/control` y `/despachos`
devuelven 404 y las doce rutas del Plan Básico siguen en 200.

## Aislamiento del código

```
src/features/
├── base/      geofence-editor
├── medium/    control-tower · dispatch-board
└── advanced/
```

Eliminar un nivel es borrar su carpeta y sus entradas del catálogo.

## Añadir una funcionalidad

1. Añadir su `FeatureId` y definición en `features.ts`.
2. Colocar el código en `src/features/<plan>/`.
3. Si tiene pantalla, declarar `route` y `showInNavigation`.
4. Consultar el acceso con `hasFeature()` / `FeatureGate`.

El middleware, el menú y los distintivos se adaptan solos.

## Pruebas

[`feature-access.test.ts`](../src/product/feature-access.test.ts) — 22 casos
que verifican, entre otros, que con Plan Básico y sin venta cruzada **ninguna**
funcionalidad de plan superior queda visible, y que el Básico permanece intacto.
