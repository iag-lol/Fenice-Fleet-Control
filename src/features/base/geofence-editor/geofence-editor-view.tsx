'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  Circle,
  Copy,
  Hexagon,
  Pencil,
  Plus,
  Shield,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { PageHeader } from '@/components/common/page-header';
import { FleetMap } from '@/components/map/fleet-map';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorBoundary } from '@/components/ui/error-boundary';
import { SearchInput, Select } from '@/components/ui/input';
import { QueryError } from '@/components/ui/query-state';
import { SkeletonRows } from '@/components/ui/skeleton';
import {
  buildInitialValues,
  GeofenceForm,
  GEOFENCE_KIND_LABEL,
  type GeofenceFormValues,
} from '@/features/base/geofence-editor/geofence-form';
import { useGeofenceDrawing } from '@/features/base/geofence-editor/use-geofence-drawing';
import { formatDistance, formatSmartDateTime, normalizeSearch } from '@/lib/format';
import { cn } from '@/lib/cn';
import type { Geofence, GeofenceGeometry, GeofenceKind } from '@/types/core';

/**
 * Editor de geocercas.
 *
 * Pertenece al PLAN BASICO: se conserva integro aunque el cliente contrate el
 * plan mas bajo. Dibujo a la izquierda, propiedades y reglas a la derecha, y
 * el listado siempre visible para no perder de vista lo que ya existe.
 */
export function GeofenceEditorView() {
  const queryClient = useQueryClient();
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const drawing = useGeofenceDrawing(map);

  const [editing, setEditing] = useState<Geofence | null>(null);
  const [composing, setComposing] = useState(false);
  const [values, setValues] = useState<GeofenceFormValues>(() => buildInitialValues(null));
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['geofences'],
    queryFn: async (): Promise<{ geofences: Geofence[] }> => {
      const response = await fetch('/api/geocercas');
      if (!response.ok) throw new Error('No fue posible cargar las geocercas.');
      return (await response.json()) as { geofences: Geofence[] };
    },
  });

  const geofences = useMemo(() => data?.geofences ?? [], [data]);

  const visible = useMemo(() => {
    const term = normalizeSearch(search);
    return geofences.filter((g) => {
      if (kindFilter && g.kind !== kindFilter) return false;
      if (term.length === 0) return true;
      return normalizeSearch(`${g.name} ${g.description ?? ''}`).includes(term);
    });
  }, [geofences, search, kindFilter]);

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['geofences'] });
    void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
  }, [queryClient]);

  const save = useMutation({
    mutationFn: async (): Promise<Geofence> => {
      if (!drawing.geometry) throw new Error('Dibuja la geocerca en el mapa.');

      const body = {
        name: values.name.trim(),
        description: values.description.trim() || null,
        kind: values.kind,
        geometry: drawing.geometry,
        rules: values.rules,
        active: values.active,
      };

      const response = await fetch(
        editing ? `/api/geocercas/${editing.id}` : '/api/geocercas',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; issues?: string[] }
          | null;
        throw new Error(payload?.issues?.join(' · ') ?? payload?.error ?? 'No fue posible guardar.');
      }

      return (await response.json()) as Geofence;
    },
    onSuccess: () => {
      invalidate();
      closeComposer();
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'No fue posible guardar.'),
  });

  const remove = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/geocercas/${id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error('No fue posible eliminar la geocerca.');
    },
    onSuccess: invalidate,
  });

  const duplicate = useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetch(`/api/geocercas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'duplicate' }),
      });
      if (!response.ok) throw new Error('No fue posible duplicar la geocerca.');
    },
    onSuccess: invalidate,
  });

  const toggleActive = useMutation({
    mutationFn: async (geofence: Geofence): Promise<void> => {
      const response = await fetch(`/api/geocercas/${geofence.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !geofence.active }),
      });
      if (!response.ok) throw new Error('No fue posible cambiar el estado.');
    },
    onSuccess: invalidate,
  });

  function closeComposer(): void {
    setComposing(false);
    setEditing(null);
    setError(null);
    setValues(buildInitialValues(null));
    drawing.cancel();
  }

  function startNew(): void {
    setEditing(null);
    setValues(buildInitialValues(null));
    setError(null);
    setComposing(true);
    drawing.startCircle();
  }

  function startEdit(geofence: Geofence): void {
    setEditing(geofence);
    setValues(buildInitialValues(geofence));
    setError(null);
    setComposing(true);
    drawing.loadGeometry(geofence.geometry);

    const center =
      geofence.geometry.shape === 'circle'
        ? geofence.geometry.center
        : geofence.geometry.vertices[0]!;
    map?.flyTo({ center: [center.lng, center.lat], zoom: 14.5, duration: 700 });
  }

  /** Cambia el radio conservando el centro dibujado. */
  const setRadius = (radiusMeters: number): void => {
    if (drawing.geometry?.shape !== 'circle') return;
    const next: GeofenceGeometry = {
      shape: 'circle',
      center: drawing.geometry.center,
      radiusMeters: Math.max(20, Math.min(5_000, Math.round(radiusMeters))),
    };
    drawing.loadGeometry(next);
  };

  return (
    <>
      <PageHeader
        breadcrumb={
          <a href="/configuracion" className="hover:text-ink">
            Configuracion
          </a>
        }
        title="Geocercas"
        description="Perimetros de entrega, zonas de carga y areas restringidas, con sus reglas de deteccion."
        actions={
          composing ? (
            <Button variant="secondary" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={closeComposer}>
              Cerrar editor
            </Button>
          ) : (
            <Button variant="primary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={startNew}>
              Nueva geocerca
            </Button>
          )
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
        {/* --- Mapa de dibujo --- */}
        <Card className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
            <Button
              size="sm"
              variant={drawing.mode === 'circle' ? 'primary' : 'secondary'}
              icon={<Circle className="h-3.5 w-3.5" />}
              onClick={() => {
                setComposing(true);
                drawing.startCircle();
              }}
            >
              Circular
            </Button>
            <Button
              size="sm"
              variant={drawing.mode === 'polygon' ? 'primary' : 'secondary'}
              icon={<Hexagon className="h-3.5 w-3.5" />}
              onClick={() => {
                setComposing(true);
                drawing.startPolygon();
              }}
            >
              Poligonal
            </Button>

            {drawing.mode === 'polygon' ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Undo2 className="h-3.5 w-3.5" />}
                  onClick={drawing.undoVertex}
                  disabled={drawing.draftVertexCount === 0}
                >
                  Deshacer
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={drawing.closePolygon}
                  disabled={drawing.draftVertexCount < 3}
                >
                  Cerrar poligono
                </Button>
              </>
            ) : null}

            {/*
              Guia paso a paso. En un telefono no hay puntero que sobrevuele
              el mapa, asi que entre el primer toque y el segundo no ocurre
              nada visible: sin esta indicacion el dibujo parece averiado.
            */}
            <p
              className={cn(
                'w-full text-xs sm:ml-auto sm:w-auto sm:text-2xs',
                drawing.mode === 'none' ? 'text-ink-faint' : 'font-medium text-brand-700',
              )}
            >
              {drawing.mode === 'circle'
                ? drawing.draftRadius !== null
                  ? `Radio ${formatDistance(drawing.draftRadius)} — toca para confirmar`
                  : drawing.centerPlaced
                    ? 'Centro fijado. Toca donde termina el radio.'
                    : 'Paso 1: toca el centro de la geocerca'
                : drawing.mode === 'polygon'
                  ? drawing.draftVertexCount === 0
                    ? 'Paso 1: toca cada esquina del perimetro'
                    : `${drawing.draftVertexCount} vertice(s) — pulsa "Cerrar" al terminar`
                  : drawing.geometry
                    ? 'Geometria lista. Ponle nombre y guardala.'
                    : 'Elige Circular o Poligonal para empezar a dibujar'}
            </p>
          </div>

          <div className="relative h-[420px] sm:h-[560px]">
            <ErrorBoundary section="el mapa del editor de geocercas">
              <FleetMap
                className="absolute inset-0"
                onMapReady={setMap}
                layerOverride={{
                  geocercas: true,
                  clientes: true,
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

        {/* --- Propiedades o listado --- */}
        <Card className="overflow-hidden">
          {composing ? (
            <>
              <div className="border-b border-line px-4 py-3">
                <p className="text-sm font-semibold text-ink">
                  {editing ? 'Editar geocerca' : 'Nueva geocerca'}
                </p>
                <p className="mt-0.5 text-2xs text-ink-faint">
                  {editing ? editing.name : 'Dibuja el perimetro y define sus reglas'}
                </p>
              </div>
              <GeofenceForm
                values={values}
                onChange={setValues}
                geometry={drawing.geometry}
                onRadiusChange={setRadius}
                onSubmit={() => save.mutate()}
                onCancel={closeComposer}
                saving={save.isPending}
                error={error}
                editing={editing !== null}
              />
            </>
          ) : (
            <>
              <div className="grid gap-2.5 border-b border-line p-3 sm:grid-cols-2">
                <SearchInput
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onClear={() => setSearch('')}
                  placeholder="Buscar geocerca"
                />
                <Select
                  value={kindFilter}
                  onChange={(event) => setKindFilter(event.target.value)}
                  aria-label="Filtrar por tipo"
                  options={[
                    { value: '', label: 'Todos los tipos' },
                    ...(Object.keys(GEOFENCE_KIND_LABEL) as GeofenceKind[]).map((kind) => ({
                      value: kind,
                      label: GEOFENCE_KIND_LABEL[kind],
                    })),
                  ]}
                />
              </div>

              <p className="border-b border-line px-3 py-2 text-xs text-ink-faint">
                <span className="numeric font-medium text-ink">{visible.length}</span> de{' '}
                <span className="numeric">{geofences.length}</span> geocercas
              </p>

              {isError ? (
                <div className="p-4">
                  <QueryError onRetry={() => void refetch()} />
                </div>
              ) : isLoading ? (
                <div className="p-4">
                  <SkeletonRows rows={6} />
                </div>
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={<Shield className="h-5 w-5" />}
                  title="No hay geocercas que coincidan con los filtros."
                  description="Crea una nueva geocerca o ajusta la busqueda."
                  action={
                    <Button size="sm" variant="secondary" onClick={startNew}>
                      Nueva geocerca
                    </Button>
                  }
                />
              ) : (
                <ul className="max-h-[520px] divide-y divide-line overflow-y-auto">
                  {visible.map((geofence) => (
                    <li key={geofence.id} className="px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(geofence)}
                          className="min-h-11 min-w-0 flex-1 text-left sm:min-h-0"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: geofence.color }}
                            />
                            <span className="truncate text-[13px] font-medium text-ink">
                              {geofence.name}
                            </span>
                          </span>
                          <span className="mt-0.5 block truncate text-2xs text-ink-faint">
                            {GEOFENCE_KIND_LABEL[geofence.kind]} ·{' '}
                            {geofence.geometry.shape === 'circle'
                              ? `circular ${formatDistance(geofence.geometry.radiusMeters)}`
                              : `poligonal ${geofence.geometry.vertices.length} vertices`}
                          </span>
                        </button>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconAction
                            label="Editar"
                            onClick={() => startEdit(geofence)}
                            icon={<Pencil className="h-3.5 w-3.5" />}
                          />
                          <IconAction
                            label="Duplicar"
                            onClick={() => duplicate.mutate(geofence.id)}
                            icon={<Copy className="h-3.5 w-3.5" />}
                          />
                          <IconAction
                            label="Eliminar"
                            danger
                            onClick={() => remove.mutate(geofence.id)}
                            icon={<Trash2 className="h-3.5 w-3.5" />}
                          />
                        </div>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggleActive.mutate(geofence)}
                          className="flex min-h-11 items-center sm:min-h-0"
                        >
                          <Badge tone={geofence.active ? 'active' : 'neutral'} dot>
                            {geofence.active ? 'Activa' : 'Inactiva'}
                          </Badge>
                        </button>
                        {geofence.rules.triggers.length > 0 ? (
                          <Badge tone="brand">
                            {geofence.rules.triggers.length} evento(s)
                          </Badge>
                        ) : (
                          <Badge tone="warning">Sin reglas</Badge>
                        )}
                        {geofence.origin === 'manual' ? (
                          <span className="text-2xs text-ink-faint">
                            Creada {formatSmartDateTime(geofence.createdAt)}
                          </span>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      </div>
    </>
  );
}

function IconAction({
  label,
  icon,
  onClick,
  danger,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        // 44 px en movil: editar y eliminar una geocerca no puede depender
        // de acertar en un objetivo de 28 px con el dedo.
        'flex h-11 w-11 items-center justify-center rounded transition-colors sm:h-7 sm:w-7',
        danger
          ? 'text-ink-faint hover:bg-status-dormant/10 hover:text-status-dormant'
          : 'text-ink-faint hover:bg-surface-800 hover:text-ink',
      )}
    >
      {icon}
    </button>
  );
}
