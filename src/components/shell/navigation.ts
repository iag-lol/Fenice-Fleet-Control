import {
  AlertTriangle,
  BarChart3,
  Building2,
  Camera,
  ClipboardList,
  LayoutDashboard,
  Map,
  MoonStar,
  Route,
  PackageCheck,
  Radar,
  Settings,
  Truck,
  type LucideIcon,
} from 'lucide-react';

import { isFeatureVisible } from '@/product/feature-access';
import type { FeatureId } from '@/product/features';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Descripcion breve usada en el menu movil. */
  hint: string;
  /** Coincidencia exacta: evita que "/" marque todas las rutas como activas. */
  exact?: boolean;
  /**
   * Funcionalidad que respalda esta entrada.
   *
   * Si el plan contratado no la cubre, la entrada desaparece del menu sin
   * necesidad de tocar este archivo ni los componentes de navegacion.
   */
  featureId?: FeatureId;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Navegacion principal. Agrupada por dominio operacional para que el operador
 * encuentre por contexto ("donde estan las cosas") y no por orden alfabetico.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Operacion',
    items: [
      { href: '/', label: 'Panel', icon: LayoutDashboard, hint: 'Indicadores del dia', exact: true },
      {
        href: '/control',
        label: 'Torre de control',
        icon: Radar,
        hint: 'Mapa y operacion en una pantalla',
        featureId: 'control-tower',
      },
      { href: '/mapa', label: 'Mapa operacional', icon: Map, hint: 'Centro de control' },
      {
        href: '/despachos',
        label: 'Despachos',
        icon: PackageCheck,
        hint: 'Entregas en curso',
        featureId: 'dispatch-board',
      },
      { href: '/alertas', label: 'Alertas', icon: AlertTriangle, hint: 'Centro de alertas' },
    ],
  },
  {
    label: 'Logistica',
    items: [
      { href: '/flota', label: 'Flota', icon: Truck, hint: 'Vehiculos y telemetria' },
      { href: '/ordenes', label: 'Ordenes de trabajo', icon: ClipboardList, hint: 'OT y despachos' },
      { href: '/rutas', label: 'Rutas', icon: Route, hint: 'Planificacion y avance' },
      {
        href: '/evidencias',
        label: 'Evidencia de entrega',
        icon: Camera,
        hint: 'Lo declarado en terreno',
        featureId: 'evidence-admin',
      },
    ],
  },
  {
    label: 'Comercial',
    items: [
      { href: '/clientes', label: 'Clientes', icon: Building2, hint: 'Cartera y estado' },
      { href: '/clientes/dormidos', label: 'Clientes dormidos', icon: MoonStar, hint: 'Riesgo comercial' },
      { href: '/territorio', label: 'Inteligencia territorial', icon: BarChart3, hint: 'Cobertura y concentracion' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      { href: '/configuracion', label: 'Configuracion', icon: Settings, hint: 'Reglas operacionales' },
    ],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Navegacion visible segun el plan contratado.
 *
 * Una entrada sin `featureId` pertenece al Plan Basico y siempre se muestra.
 * El resto aparece solo cuando su funcionalidad esta disponible o se anuncia
 * como mejora.
 */
export function getVisibleNavGroups(): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) => item.featureId === undefined || isFeatureVisible(item.featureId),
    ),
  })).filter((group) => group.items.length > 0);
}

/**
 * Accesos directos de la barra inferior en movil.
 *
 * Se declaran por RUTA y no por indice: seleccionarlos por posicion hacia que
 * insertar una entrada en el menu cambiara en silencio la barra inferior, y
 * que apareciera ahi una pantalla que el plan contratado ni siquiera incluye.
 */
const MOBILE_PRIMARY_HREFS = ['/', '/mapa', '/flota', '/ordenes'] as const;

export function getMobilePrimary(): NavItem[] {
  // Busqueda directa en lugar de un indice: el identificador `Map` ya lo ocupa
  // el icono de lucide en este modulo, y con quince entradas el coste es nulo.
  return MOBILE_PRIMARY_HREFS.map((href) =>
    ALL_NAV_ITEMS.find((item) => item.href === href),
  ).filter(
    (item): item is NavItem =>
      item !== undefined &&
      (item.featureId === undefined || isFeatureVisible(item.featureId)),
  );
}

export function isActivePath(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  // "/clientes/dormidos" no debe activar tambien "/clientes".
  if (item.href === '/clientes') return pathname === '/clientes' || /^\/clientes\/(?!dormidos)/.test(pathname);
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}
