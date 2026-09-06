'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Map as MapLibreMap, MapMouseEvent } from 'maplibre-gl';
import { MapPin, Search, Trash2, Warehouse } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { FleetMap } from '@/components/map/fleet-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { Input, Select } from '@/components/ui/input';
import { useGeofenceDrawing } from '@/features/base/geofence-editor/use-geofence-drawing';
import { formatDistance } from '@/lib/format';
import type { Geofence, GeofenceKind, LatLng } from '@/types/core';

/**
 * Puntos de partida: la central de la empresa y los puntos de carga de
 * combustible desde donde salen los camiones.
 *
 * Son geocercas normales (tipo `centro_operacional` o `carga`), creadas de
 * forma guiada: nombre + direccion en vez de dibujar a mano, con un radio
 * fijo de 300 m y las reglas de entrada/salida ya activadas, para que
 * cualquier camion que entre o salga quede alertado sin configuracion
 * adicional. Se puede buscar la direccion o, si la geocodificacion no esta
 * disponible, marcar el punto directamente en el mapa.
 */

const RADIUS_METERS = 300;

const KIND_OPTIONS: { value: Extract<GeofenceKind, 'centro_operacional' | 'carga'>; label: string }[] = [
  { value: 'centro_operacional', label: 'Central de la empresa' },
  { value: 'carga', label: 'Punto de carga de combustible' },
];

interface GeocodeResult {
  coordinates: LatLng;
  formattedAddress: string;
  confidence: number;
  provider: string;
}

export function DepotPointView() {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const drawing = useGeofenceDrawing(map);

  const [name, setName] = useState('');
  const [kind, setKind] = useState<'centro_operacional' | 'carga'>('centro_operacional');
  const [address, setAddress] = useState('');
  const [commune, setCommune] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [geocodeNote, setGeocodeNote] = useState<string | null>(null);

  const { data } = useQuery({
    queryKey: ['geofences'],
    queryFn: async (): Promise<{ geofences: Geofence[] }> => {
      const response = await fetch('/api/geocercas');
      if (!response.ok) throw new Error('No fue posible cargar los puntos de partida.');
      return (await response.json()) as { geofences: Geofence[] };
    },
  });

  const geofences = useMemo(() => data?.geofences ?? [], [data]);
  const depotPoints = useMemo(
    () => geofences.filter((g) => g.kind === 'centro_operacional' || g.kind === 'carga'),
    [geofences],
  );

  const placeAt = (point: LatLng): void => {
    drawing.loadGeometry({ shape: 'circle', center: point, radiusMeters: RADIUS_METERS });
  };

  // Un clic en el mapa marca (o corrige) el punto directamente: no depende de
  // que la geocodificacion este configurada.
  useEffect(() => {
    if (!map) return;

    const onClick = (event: MapMouseEvent): void => {
      placeAt({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      setGeocodeNote(null);
    };

    map.getCanvas().style.cursor = 'crosshair';
    map.on('click', onClick);
    return () => {
      map.getCanvas().style.cursor = '';
      map.off('click', onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  const geocode = useMutation({
    mutationFn: async (): Promise<GeocodeResult> => {
      const response = await fetch('/api/geocodificar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addressLine: address, communeName: commune || undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'No fue posible ubicar esa direccion.');
      }
      return (await response.json()) as GeocodeResult;
    },
    onSuccess: (result) => {
      placeAt(result.coordinates);
      map?.flyTo({ center: [result.coordinates.lng, result.coordinates.lat], zoom: 15.5, duration: 700 });
      setGeocodeNote(`Ubicado: ${result.formattedAddress}`);
      setError(null);
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No fue posible ubicar esa direccion.'),
  });

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      if (!drawing.geometry) throw new Error('Marca el punto en el mapa o busca su direccion.');

      const response = await fetch('/api/geocercas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: address.trim() || null,
          kind,
          geometry: drawing.geometry,
          rules: {
            triggers: ['entrada', 'salida'],
            minDwellSeconds: null,
            maxDwellSeconds: null,
            allowedFrom: null,
            allowedTo: null,
            allowedVehicleIds: [],
            severity: 'warning',
          },
          active: true,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string; issues?: string[] }
          | null;
        throw new Error(body?.issues?.join(' · ') ?? body?.error ?? 'No fue posible guardar el punto.');
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['geofences'] });
      void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
      setName('');
      setAddress('');
      setCommune('');
      setGeocodeNote(null);
      setError(null);
      drawing.cancel();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No fue posible guardar el punto.'),
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/geocercas/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('No fue posible eliminar el punto.');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['geofences'] });
      void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
    },
  });

  const canSave = name.trim().length >= 2 && drawing.geometry !== null;

  return (
    <>
      <PageHeader
        breadcrumb={
          <a href="/configuracion" className="hover:text-ink">
            Configuracion
          </a>
        }
        title="Puntos de partida"
        description="La central de la empresa y los puntos de carga de combustible. Cualquier camion que entre o salga queda alertado."
      />

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        <Card className="overflow-hidden">
          <div className="border-b border-line px-3 py-2.5">
            <p className="text-xs text-ink-faint">
              {drawing.geometry
                ? 'Punto marcado. Ajustalo con otro clic si es necesario.'
                : 'Busca la direccion o toca el mapa para marcar el punto (radio fijo de 300 m).'}
            </p>
          </div>

          <div className="relative h-[420px] sm:h-[560px]">
            <ErrorBoundary section="el mapa de puntos de partida">
              <FleetMap
                className="absolute inset-0"
                onMapReady={setMap}
                layerOverride={{
                  geocercas: true,
                  clientes: false,
                  camiones: false,
                  rutas: false,
                  calor: false,
                  pedidos: false,
                  alertas: false,
                  comunas: false,
                }}
                vehicles={[]}
                clients={[]}
                routes={[]}
                geofences={geofences}
                alerts={[]}
                workOrders={[]}
                communes={[]}
                heatmapPoints={[]}
              />
            </ErrorBoundary>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="space-y-4 p-4">
            <div>
              <label className="field-label" htmlFor="dp-nombre">
                Nombre
              </label>
              <Input
                id="dp-nombre"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej: Central Fenice / Planta Maipu"
              />
              <p className="mt-1 text-2xs text-ink-faint">Este nombre se muestra sobre el punto en el mapa.</p>
            </div>

            <div>
              <label className="field-label" htmlFor="dp-tipo">
                Tipo
              </label>
              <Select
                id="dp-tipo"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
                options={KIND_OPTIONS}
              />
            </div>

            <div>
              <label className="field-label" htmlFor="dp-direccion">
                Direccion
              </label>
              <div className="flex gap-2">
                <Input
                  id="dp-direccion"
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  placeholder="Av. Ejemplo 1234"
                  className="flex-1"
                />
                <Button
                  variant="secondary"
                  size="md"
                  icon={<Search className="h-3.5 w-3.5" />}
                  onClick={() => geocode.mutate()}
                  loading={geocode.isPending}
                  disabled={address.trim().length < 4}
                >
                  Buscar
                </Button>
              </div>
              <Input
                className="mt-2"
                value={commune}
                onChange={(event) => setCommune(event.target.value)}
                placeholder="Comuna (opcional)"
              />
              {geocodeNote ? <p className="mt-1 text-2xs text-brand-700">{geocodeNote}</p> : null}
              <p className="mt-1 text-2xs text-ink-faint">
                Si la busqueda no encuentra la direccion, toca el punto directamente en el mapa.
              </p>
            </div>

            {error ? (
              <p className="rounded-md border border-status-dormant/30 bg-status-dormant/5 px-3 py-2 text-xs text-ink">
                {error}
              </p>
            ) : null}

            <Button variant="primary" block onClick={() => save.mutate()} loading={save.isPending} disabled={!canSave}>
              Crear punto de partida
            </Button>
          </div>

          <div className="border-t border-line px-4 py-2.5 text-xs font-medium text-ink-faint">
            Puntos existentes ({depotPoints.length})
          </div>

          {depotPoints.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<Warehouse className="h-5 w-5" />}
                title="Aun no hay puntos de partida."
                description="Crea la central de la empresa o un punto de carga con el formulario de arriba."
              />
            </div>
          ) : (
            <ul className="max-h-[320px] divide-y divide-line overflow-y-auto">
              {depotPoints.map((geofence) => (
                <li key={geofence.id} className="flex items-start justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <span className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                      <span className="truncate text-[13px] font-medium text-ink">{geofence.name}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-2xs text-ink-faint">
                      <Badge tone={geofence.kind === 'centro_operacional' ? 'brand' : 'neutral'}>
                        {geofence.kind === 'centro_operacional' ? 'Central' : 'Carga'}
                      </Badge>
                      {geofence.geometry.shape === 'circle'
                        ? `radio ${formatDistance(geofence.geometry.radiusMeters)}`
                        : null}
                    </span>
                  </div>
                  <button
                    type="button"
                    title="Eliminar"
                    aria-label="Eliminar"
                    onClick={() => remove.mutate(geofence.id)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-status-dormant/10 hover:text-status-dormant"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
