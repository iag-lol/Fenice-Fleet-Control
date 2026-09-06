import type { FeatureImplementationState, ProductPlan } from '@/product/plans';

/**
 * Catalogo unico de funcionalidades.
 *
 * Toda decision de "esto se ve / esto se puede usar" nace de aqui. No debe
 * existir en ninguna parte del codigo una comparacion suelta del estilo
 * `if (plan === 'medium')`: cuando el cliente contrate un plan distinto,
 * cambia una variable de entorno y no cuarenta archivos.
 */

export type FeatureCategory =
  | 'operacion'
  | 'mapa'
  | 'flota'
  | 'rutas'
  | 'entregas'
  | 'comercial'
  | 'conductor'
  | 'cliente'
  | 'analitica'
  | 'integraciones'
  | 'sistema';

export const CATEGORY_LABEL: Record<FeatureCategory, string> = {
  operacion: 'Operacion',
  mapa: 'Mapa',
  flota: 'Flota',
  rutas: 'Rutas',
  entregas: 'Entregas',
  comercial: 'Comercial',
  conductor: 'Conductor',
  cliente: 'Cliente',
  analitica: 'Analitica',
  integraciones: 'Integraciones',
  sistema: 'Sistema',
};

export interface FeatureDefinition {
  id: FeatureId;
  name: string;
  description: string;
  minimumPlan: ProductPlan;
  category: FeatureCategory;
  /** Estado real, independiente del plan contratado. */
  implementationState: Exclude<FeatureImplementationState, 'locked'>;
  /** Ruta asociada, si la funcion tiene pantalla propia. */
  route?: string;
  /** Aparece en la navegacion principal cuando esta disponible. */
  showInNavigation?: boolean;
  /** Se anuncia como mejora cuando el plan contratado no la cubre. */
  showAsUpgrade?: boolean;
  /** Variables de entorno que la funcion necesita para operar. */
  requiredEnv?: readonly string[];
}

export type FeatureId =
  // --- Plan Basico ---
  | 'dashboard'
  | 'operational-map'
  | 'fleet-tracking'
  | 'client-portfolio'
  | 'dormant-clients'
  | 'work-orders'
  | 'routes'
  | 'geofences'
  | 'geofence-editor'
  | 'depot-points'
  | 'alerts'
  | 'territory-intelligence'
  | 'heatmap'
  | 'public-tracking'
  | 'operational-settings'
  | 'administrative-boundaries'
  // --- Plan Medio ---
  | 'control-tower'
  | 'vehicle-operational-panel'
  | 'follow-mode-advanced'
  | 'satellite-view'
  | 'hybrid-view'
  | 'live-traffic'
  | 'traffic-eta'
  | 'traffic-alerts'
  | 'route-replay'
  | 'route-control'
  | 'dispatch-board'
  | 'delivery-detection'
  | 'customer-tracking-advanced'
  | 'tracking-qr'
  | 'driver-portal'
  | 'driver-pwa'
  | 'proof-of-delivery'
  | 'incident-reporting'
  | 'evidence-admin'
  | 'command-palette'
  | 'filter-presets'
  | 'split-view'
  | 'dark-map'
  | 'measurement-tools'
  | 'reverse-geocoding'
  | 'activity-timeline'
  | 'client-about-to-sleep'
  | 'sla-tracking'
  | 'operational-exports'
  // --- Plan Avanzado ---
  | 'map-3d'
  | 'satellite-3d'
  | 'globe-view'
  | 'smart-dispatch'
  | 'route-optimization'
  | 'predictive-eta'
  | 'delay-risk'
  | 'anomaly-detection'
  | 'operational-ai'
  | 'territorial-opportunity'
  | 'isochrones'
  | 'route-profitability'
  | 'advanced-telemetry'
  | 'driving-behaviour'
  | 'alert-rule-builder'
  | 'erp-integrations'
  | 'external-notifications'
  | 'executive-reports'
  | 'public-api'
  | 'control-room'
  | 'route-score'
  | 'geographic-lasso'
  | 'turn-by-turn'
  | 'delivery-pdf'
  | 'evidence-hash';

/**
 * Definiciones. El orden dentro de cada plan es el de aparicion en la
 * pantalla de planes.
 */
export const FEATURES: readonly FeatureDefinition[] = [
  // -------------------------------------------------------------------------
  // PLAN BASICO — linea base aprobada
  // -------------------------------------------------------------------------
  {
    id: 'dashboard',
    name: 'Panel operacional',
    description: 'Indicadores de flota, despachos, cartera y alertas del dia.',
    minimumPlan: 'base',
    category: 'operacion',
    implementationState: 'active',
    route: '/',
    showInNavigation: true,
  },
  {
    id: 'operational-map',
    name: 'Torre de control',
    description: 'Camiones, clientes, rutas y geocercas sobre un mapa unico.',
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'active',
    // Una sola pantalla de mapa para todos los planes. En Basico es el mapa a
    // pantalla completa; el Plan Medio le anade el panel de operacion encima.
    // Tener dos entradas distintas para el mismo mapa confundia sin aportar.
    route: '/control',
    showInNavigation: true,
  },
  {
    id: 'fleet-tracking',
    name: 'Seguimiento de flota',
    description: 'Posicion, estado y telemetria de cada vehiculo.',
    minimumPlan: 'base',
    category: 'flota',
    implementationState: 'active',
    route: '/flota',
    showInNavigation: true,
  },
  {
    id: 'client-portfolio',
    name: 'Cartera de clientes',
    description: 'Estado comercial verde, ambar y rojo calculado por umbrales.',
    minimumPlan: 'base',
    category: 'comercial',
    implementationState: 'active',
    route: '/clientes',
    showInNavigation: true,
  },
  {
    id: 'dormant-clients',
    name: 'Clientes dormidos',
    description: 'Cartera en riesgo escalonada por gravedad, con vista en mapa.',
    minimumPlan: 'base',
    category: 'comercial',
    implementationState: 'active',
    route: '/clientes/dormidos',
    showInNavigation: true,
  },
  {
    id: 'work-orders',
    name: 'Ordenes de trabajo',
    description: 'Despachos con trazabilidad GPS y evidencia de visita.',
    minimumPlan: 'base',
    category: 'operacion',
    implementationState: 'active',
    route: '/ordenes',
    showInNavigation: true,
  },
  {
    id: 'routes',
    name: 'Rutas',
    description: 'Corredor planificado por calle, paradas y avance real.',
    minimumPlan: 'base',
    category: 'rutas',
    implementationState: 'active',
    route: '/rutas',
    showInNavigation: true,
  },
  {
    id: 'geofences',
    name: 'Geocercas',
    description: 'Perimetros de entrega, zonas autorizadas y restringidas.',
    minimumPlan: 'base',
    category: 'entregas',
    implementationState: 'active',
  },
  {
    id: 'geofence-editor',
    name: 'Editor de geocercas',
    description: 'Creacion circular y poligonal con reglas de alerta propias.',
    minimumPlan: 'base',
    category: 'entregas',
    implementationState: 'active',
    route: '/configuracion/geocercas',
  },
  {
    id: 'depot-points',
    name: 'Puntos de partida',
    description: 'Alta guiada de la central y los puntos de carga, con geocerca de 300 m automatica.',
    minimumPlan: 'base',
    category: 'entregas',
    implementationState: 'active',
    route: '/configuracion/puntos-partida',
  },
  {
    id: 'alerts',
    name: 'Centro de alertas',
    description: 'Incidencias de GPS, ruta, geocerca, cliente y operacion.',
    minimumPlan: 'base',
    category: 'operacion',
    implementationState: 'active',
    route: '/alertas',
    showInNavigation: true,
  },
  {
    id: 'territory-intelligence',
    name: 'Inteligencia territorial',
    description: 'Cobertura por comuna, concentracion y sectores sin presencia.',
    minimumPlan: 'base',
    category: 'comercial',
    implementationState: 'active',
    route: '/territorio',
    showInNavigation: true,
  },
  {
    id: 'heatmap',
    name: 'Mapa de calor',
    description: 'Concentracion de clientes, pedidos, visitas y cartera dormida.',
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'active',
  },
  {
    id: 'public-tracking',
    name: 'Seguimiento publico',
    description: 'Consulta del pedido por numero de orden, sin autenticacion.',
    minimumPlan: 'base',
    category: 'cliente',
    implementationState: 'active',
    route: '/seguimiento',
  },
  {
    id: 'operational-settings',
    name: 'Configuracion operacional',
    description: 'Umbrales que gobiernan estados, alertas y geocercas.',
    minimumPlan: 'base',
    category: 'sistema',
    implementationState: 'active',
    route: '/configuracion',
    showInNavigation: true,
  },
  {
    id: 'administrative-boundaries',
    name: 'Limites comunales oficiales',
    description: 'Division politico-administrativa real para analisis territorial.',
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'active',
  },

  // -------------------------------------------------------------------------
  // PLAN MEDIO
  // -------------------------------------------------------------------------
  {
    id: 'control-tower',
    name: 'Panel de operacion en la torre',
    description: 'Panel lateral con flota, despachos, alertas y rutas junto al mapa.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    // NO declara ruta: no es una pantalla aparte, sino el panel que se suma a
    // la torre de control. Si declarara `/control`, el middleware bloquearia
    // en Plan Basico la unica pantalla de mapa que ese plan si incluye.
    showInNavigation: false,
    showAsUpgrade: true,
  },
  {
    id: 'vehicle-operational-panel',
    name: 'Panel operacional del vehiculo',
    description: 'Orden actual, avance de ruta, proxima parada y acciones rapidas.',
    minimumPlan: 'medium',
    category: 'flota',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'follow-mode-advanced',
    name: 'Seguimiento de vehiculo',
    description: 'Camara adherida al camion, con orientacion segun su rumbo.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'satellite-view',
    name: 'Vista satelital',
    description: 'Imagineria satelital real del area de operacion.',
    // Pasa a Basico: se sirve con imagineria de Esri, que no exige clave ni
    // contrato. Reservarla a un plan superior seria cobrar por algo gratuito.
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'active',
  },
  {
    id: 'hybrid-view',
    name: 'Vista hibrida',
    description: 'Satelite con calles, nombres y limites encima.',
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'active',
  },
  {
    id: 'live-traffic',
    name: 'Trafico en tiempo real',
    description: 'Congestion actual sobre las vias de la operacion.',
    // Disponible en Basico, pero sigue exigiendo un proveedor: NO existe
    // ninguna fuente de trafico sin clave. El control se muestra y explica
    // que falta configurarlo, en vez de fingir congestion inventada.
    minimumPlan: 'base',
    category: 'mapa',
    implementationState: 'requires-provider',
    requiredEnv: ['TRAFFIC_PROVIDER', 'TRAFFIC_API_KEY'],
  },
  {
    id: 'traffic-eta',
    name: 'ETA con trafico',
    description: 'Tiempo de llegada corregido por la congestion del trayecto.',
    minimumPlan: 'medium',
    category: 'rutas',
    implementationState: 'requires-provider',
    requiredEnv: ['TRAFFIC_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'traffic-alerts',
    name: 'Alertas de trafico',
    description: 'Aviso cuando una ruta activa atraviesa congestion severa.',
    minimumPlan: 'medium',
    category: 'operacion',
    implementationState: 'requires-provider',
    requiredEnv: ['TRAFFIC_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'route-replay',
    name: 'Reproduccion de ruta',
    description: 'Recorrido historico del camion con linea de tiempo y eventos.',
    minimumPlan: 'medium',
    category: 'rutas',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'route-control',
    name: 'Control de rutas',
    description: 'Estado, avance, retraso y cumplimiento de cada ruta del dia.',
    minimumPlan: 'medium',
    category: 'rutas',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'dispatch-board',
    name: 'Panel de despachos',
    description: 'Despachos en curso con ETA, retraso y acceso directo al mapa.',
    minimumPlan: 'medium',
    category: 'operacion',
    implementationState: 'active',
    route: '/despachos',
    showInNavigation: true,
    showAsUpgrade: true,
  },
  {
    id: 'delivery-detection',
    name: 'Deteccion automatica de entrega',
    description: 'La entrada del camion a la geocerca del pedido confirma la entrega.',
    minimumPlan: 'medium',
    category: 'entregas',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'customer-tracking-advanced',
    name: 'Portal del cliente',
    description: 'Seguimiento con mapa, progreso y corte automatico tras la entrega.',
    minimumPlan: 'medium',
    category: 'cliente',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'tracking-qr',
    name: 'QR de seguimiento',
    description: 'Codigo y enlace para que el cliente siga su pedido.',
    minimumPlan: 'medium',
    category: 'cliente',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'driver-portal',
    name: 'Portal del conductor',
    description: 'Ruta, paradas y entregas del conductor, con acceso por enlace seguro.',
    minimumPlan: 'medium',
    category: 'conductor',
    implementationState: 'active',
    // Declara ruta para que el middleware la bloquee de verdad en Plan
    // Basico. No aparece en el menu: el conductor llega por su enlace, no
    // navegando, y el operador no tiene nada que hacer en esta pantalla.
    route: '/conductor',
    showInNavigation: false,
    showAsUpgrade: true,
  },
  {
    id: 'driver-pwa',
    name: 'Aplicacion instalable',
    description: 'El portal del conductor se instala en el telefono como una app.',
    minimumPlan: 'medium',
    category: 'conductor',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'proof-of-delivery',
    name: 'Evidencia de entrega',
    description: 'Fotografia, receptor, comentario y posicion en cada entrega.',
    minimumPlan: 'medium',
    category: 'entregas',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'incident-reporting',
    name: 'Reporte de incidencias',
    description: 'El conductor informa el motivo de una entrega fallida.',
    minimumPlan: 'medium',
    category: 'conductor',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'evidence-admin',
    name: 'Evidencia en administracion',
    description: 'Galeria y detalle de la evidencia recogida en terreno.',
    minimumPlan: 'medium',
    category: 'entregas',
    implementationState: 'active',
    route: '/evidencias',
    showInNavigation: true,
    showAsUpgrade: true,
  },
  {
    id: 'command-palette',
    name: 'Paleta de comandos',
    description: 'Busqueda operacional inmediata con Ctrl+K.',
    minimumPlan: 'medium',
    category: 'sistema',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'filter-presets',
    name: 'Filtros guardados',
    description: 'Combinaciones de filtro reutilizables por el equipo.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'split-view',
    name: 'Vista dividida',
    description: 'Mapa y listado operacional lado a lado, redimensionables.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'dark-map',
    name: 'Mapa nocturno',
    description: 'Estilo oscuro del mapa para turnos de noche.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'measurement-tools',
    name: 'Herramientas de medicion',
    description: 'Medir distancias y superficies sobre el mapa.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'reverse-geocoding',
    name: 'Direccion aproximada',
    description: 'Traduce la posicion del camion a una direccion legible.',
    minimumPlan: 'medium',
    category: 'mapa',
    implementationState: 'requires-provider',
    requiredEnv: ['GEOCODING_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'activity-timeline',
    name: 'Tablero de actividad',
    description: 'Linea de tiempo global de lo que ocurre en la operacion.',
    minimumPlan: 'medium',
    category: 'operacion',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'client-about-to-sleep',
    name: 'Clientes proximos a dormirse',
    description: 'Cartera que cruzara el umbral de riesgo en los proximos dias.',
    minimumPlan: 'medium',
    category: 'comercial',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'sla-tracking',
    name: 'Cumplimiento de ventana',
    description: 'Entregas a tiempo, en riesgo y atrasadas respecto al compromiso.',
    minimumPlan: 'medium',
    category: 'entregas',
    implementationState: 'active',
    showAsUpgrade: true,
  },
  {
    id: 'operational-exports',
    name: 'Exportaciones operacionales',
    description: 'Descarga de rutas, entregas, alertas y cartera en CSV.',
    minimumPlan: 'medium',
    category: 'operacion',
    implementationState: 'active',
    showAsUpgrade: true,
  },

  // -------------------------------------------------------------------------
  // PLAN AVANZADO
  // -------------------------------------------------------------------------
  {
    id: 'map-3d',
    name: 'Vista 3D',
    description: 'Terreno con inclinacion y rotacion para leer relieve y accesos.',
    minimumPlan: 'advanced',
    category: 'mapa',
    implementationState: 'requires-provider',
    requiredEnv: ['NEXT_PUBLIC_TERRAIN_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'satellite-3d',
    name: 'Satelite con terreno 3D',
    description: 'Imagineria satelital sobre elevacion real del terreno.',
    minimumPlan: 'advanced',
    category: 'mapa',
    implementationState: 'requires-provider',
    requiredEnv: ['NEXT_PUBLIC_TERRAIN_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'globe-view',
    name: 'Vista globo',
    description: 'Proyeccion esferica para operaciones de alcance nacional.',
    minimumPlan: 'advanced',
    category: 'mapa',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'smart-dispatch',
    name: 'Asignacion inteligente',
    description: 'Sugiere que camion deberia tomar cada orden segun cercania y carga.',
    minimumPlan: 'advanced',
    category: 'operacion',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'route-optimization',
    name: 'Optimizacion multi-vehiculo',
    description: 'Reparte entregas entre camiones considerando ventanas y capacidad.',
    minimumPlan: 'advanced',
    category: 'rutas',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'predictive-eta',
    name: 'ETA predictivo',
    description: 'Llegada estimada a partir del historico real de la operacion.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'delay-risk',
    name: 'Riesgo de atraso',
    description: 'Probabilidad de incumplir la ventana, con sus factores explicados.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'anomaly-detection',
    name: 'Deteccion de anomalias',
    description: 'Detenciones, horarios y recorridos fuera de lo habitual.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'operational-ai',
    name: 'Asistente operacional',
    description: 'Consultas en lenguaje natural sobre el estado de la operacion.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'requires-provider',
    requiredEnv: ['AI_PROVIDER', 'AI_API_KEY'],
    showAsUpgrade: true,
  },
  {
    id: 'territorial-opportunity',
    name: 'Oportunidad territorial',
    description: 'Zonas con potencial comercial no atendido.',
    minimumPlan: 'advanced',
    category: 'comercial',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'isochrones',
    name: 'Isocronas',
    description: 'Que clientes quedan a 15, 30 o 45 minutos de cada camion.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'requires-provider',
    requiredEnv: ['ROUTING_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'route-profitability',
    name: 'Rentabilidad de rutas',
    description: 'Costo por entrega, consumo y eficiencia por ruta.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'advanced-telemetry',
    name: 'Telemetria avanzada',
    description: 'Voltaje, entradas digitales y sensores del equipo instalado.',
    minimumPlan: 'advanced',
    category: 'flota',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'driving-behaviour',
    name: 'Comportamiento de conduccion',
    description: 'Frenadas, aceleraciones y ralenti reportados por el equipo.',
    minimumPlan: 'advanced',
    category: 'flota',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'alert-rule-builder',
    name: 'Constructor de reglas de alerta',
    description: 'Reglas propias combinando condiciones sin escribir codigo.',
    minimumPlan: 'advanced',
    category: 'operacion',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'erp-integrations',
    name: 'Integraciones ERP y CRM',
    description: 'Sincronizacion bidireccional con los sistemas de gestion.',
    minimumPlan: 'advanced',
    category: 'integraciones',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'external-notifications',
    name: 'Notificaciones externas',
    description: 'Aviso automatico por correo, WhatsApp o webhook.',
    minimumPlan: 'advanced',
    category: 'integraciones',
    implementationState: 'requires-provider',
    requiredEnv: ['NOTIFICATION_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'executive-reports',
    name: 'Reportes ejecutivos',
    description: 'Informes periodicos de operacion listos para direccion.',
    minimumPlan: 'advanced',
    category: 'analitica',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'public-api',
    name: 'API y webhooks',
    description: 'Acceso programatico a la operacion para sistemas de terceros.',
    minimumPlan: 'advanced',
    category: 'integraciones',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'control-room',
    name: 'Modo sala de control',
    description: 'Tablero para pantalla grande, sin navegacion administrativa.',
    minimumPlan: 'advanced',
    category: 'operacion',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'route-score',
    name: 'Indice de cumplimiento de ruta',
    description: 'Comparacion entre la ruta programada y la realmente ejecutada.',
    minimumPlan: 'advanced',
    category: 'rutas',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'geographic-lasso',
    name: 'Seleccion geografica',
    description: 'Dibujar un area y obtener todo lo que contiene.',
    minimumPlan: 'advanced',
    category: 'mapa',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'turn-by-turn',
    name: 'Navegacion guiada',
    description: 'Indicaciones giro a giro dentro del portal del conductor.',
    minimumPlan: 'advanced',
    category: 'conductor',
    implementationState: 'requires-provider',
    requiredEnv: ['ROUTING_PROVIDER'],
    showAsUpgrade: true,
  },
  {
    id: 'delivery-pdf',
    name: 'Comprobante de entrega',
    description: 'Documento firmado con evidencia, ubicacion y horario.',
    minimumPlan: 'advanced',
    category: 'entregas',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
  {
    id: 'evidence-hash',
    name: 'Sellado de evidencia',
    description: 'Huella criptografica que detecta alteraciones posteriores.',
    minimumPlan: 'advanced',
    category: 'entregas',
    implementationState: 'ready',
    showAsUpgrade: true,
  },
];

const BY_ID = new Map(FEATURES.map((f) => [f.id, f]));

export function getFeature(id: FeatureId): FeatureDefinition {
  const feature = BY_ID.get(id);
  // Un identificador desconocido es un error de programacion, no un caso
  // de negocio: es preferible fallar de inmediato a mostrar algo incorrecto.
  if (!feature) throw new Error(`Funcionalidad desconocida: ${id}`);
  return feature;
}

export function getFeaturesByPlan(plan: ProductPlan): FeatureDefinition[] {
  return FEATURES.filter((f) => f.minimumPlan === plan);
}
