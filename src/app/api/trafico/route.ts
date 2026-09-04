import { handleApi } from '@/lib/api';
import { getServerEnv } from '@/config/env';
import { getGpsProvider } from '@/services/registry';
import { getTrafficProvider } from '@/services/traffic/traffic-provider';
import {
  isWithinWindow,
  planTrafficPolling,
  type OperatingWindow,
} from '@/services/traffic/traffic-quota';
import type { TrafficSegment } from '@/services/traffic/traffic-provider';

export const dynamic = 'force-dynamic';

/**
 * Congestion vial actual, con la cuota mensual bajo control.
 *
 * Devuelve siempre la disponibilidad del proveedor junto a los datos, para que
 * la interfaz pueda distinguir "no hay congestion" de "no lo sabemos".
 * Confundir ambas cosas seria el peor resultado posible de esta capa.
 *
 * El nivel gratuito de TomTom da 200.000 consultas al mes. Aqui se protege de
 * dos formas:
 *
 *  1. FUERA DE LA JORNADA no se consulta nada. De noche y en fin de semana no
 *     hay camiones en ruta; gastar cuota ahi seria tirarla.
 *  2. DENTRO DE LA JORNADA se cachea el resultado durante el intervalo que la
 *     cuota permite para el tamano real de la flota. Varias pantallas abiertas
 *     comparten la misma consulta en lugar de multiplicarla.
 */

interface Cache {
  segments: TrafficSegment[];
  expiresAt: number;
}

const globalForTraffic = globalThis as unknown as { __feniceTrafficCache?: Cache };

function buildWindow(): OperatingWindow {
  const env = getServerEnv();
  return {
    startHour: env.TRAFFIC_WINDOW_START_HOUR,
    endHour: env.TRAFFIC_WINDOW_END_HOUR,
    weekdays: env.TRAFFIC_WINDOW_WEEKDAYS,
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  return handleApi(async () => {
    const provider = getTrafficProvider();
    const env = getServerEnv();
    const window = buildWindow();
    const now = new Date();

    if (!provider.info.available) {
      return { provider: provider.info, segments: [], quota: null };
    }

    // La flota determina el gasto: se consulta el tramo de cada camion.
    const reportando = await getGpsProvider()
      .getAllCurrentPositions()
      .then((p) => p.filter((x) => x.valid).length)
      .catch(() => 0);

    // Se dimensiona con el MAYOR entre lo que reporta ahora y la flota
    // prevista. Antes de conectar el GPS reportan cero, y de madrugada casi
    // ninguno: dimensionar con ese numero daria un intervalo demasiado corto
    // y el gasto se dispararia al volver la flota completa.
    const vehicles = Math.max(reportando, env.TRAFFIC_EXPECTED_FLEET);

    const plan = planTrafficPolling(vehicles, env.TRAFFIC_MONTHLY_QUOTA, window);
    const dentroDeJornada = isWithinWindow(now, window);

    const quota = {
      dentroDeJornada,
      intervaloSegundos: plan.intervalSeconds,
      consultasMensualesEstimadas: plan.monthlyRequests,
      usoDeCuota: Math.round(plan.quotaUsage * 100) / 100,
      vehiculos: vehicles,
      vehiculosReportando: reportando,
    };

    const cache = globalForTraffic.__feniceTrafficCache;

    if (!dentroDeJornada) {
      // Se devuelve lo ultimo conocido en lugar de un vacio: un mapa que pierde
      // el trafico al dar las 19:00 parece averiado.
      return { provider: provider.info, segments: cache?.segments ?? [], quota };
    }

    if (cache && now.getTime() < cache.expiresAt) {
      return { provider: provider.info, segments: cache.segments, quota };
    }

    const bounds = {
      minLat: Number(url.searchParams.get('minLat') ?? '-33.72'),
      maxLat: Number(url.searchParams.get('maxLat') ?? '-33.28'),
      minLng: Number(url.searchParams.get('minLng') ?? '-70.87'),
      maxLng: Number(url.searchParams.get('maxLng') ?? '-70.45'),
    };

    const segments = await provider.getSegments(bounds);
    globalForTraffic.__feniceTrafficCache = {
      segments,
      expiresAt: now.getTime() + Math.max(15, plan.intervalSeconds) * 1000,
    };

    return { provider: provider.info, segments, quota };
  }, 'el trafico actual');
}
