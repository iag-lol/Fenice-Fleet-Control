# Proveedores de mapa

Cómo configurar cartografía, satélite, tráfico, ruteo y geocodificación.

## Mapa base

```bash
# osm | maptiler | mapbox | carto-light
NEXT_PUBLIC_MAP_PROVIDER=osm
NEXT_PUBLIC_MAPTILER_KEY=
NEXT_PUBLIC_MAPBOX_TOKEN=
```

| Proveedor | Clave | Notas |
|---|---|---|
| `osm` | No | **Por defecto.** Desaturado al 92 % para que el mapa sea guía de calles y el color quede en los datos |
| `maptiler` | Sí | Vectorial. Recomendado para producción |
| `mapbox` | Sí | Vectorial |
| `carto-light` | Sí | **Ya no funciona sin clave**: devuelve 200 con la marca de agua "API KEY REQUIRED" incrustada |

Sin clave, la plataforma degrada a OpenStreetMap e informa el motivo en el mapa
en lugar de mostrar una pantalla vacía.

### Trampa de las etiquetas

El servidor de glifos debe servir las fuentes que se le piden. Si devuelve HTML
en lugar de un protobuf —algunos responden 200 con una página de error—,
MapLibre lo parsea como protobuf, el bucket de símbolos revienta y **se pierde
el tile completo**, arrastrando los círculos e iconos de la misma fuente.

El síntoma es un mapa sin clientes ni paradas, sin ningún error visible. Por eso
solo se piden fuentes sueltas (`Noto Sans Regular`, `Noto Sans Bold`), nunca
pilas compuestas: esas responden 404 con HTML.

## Satélite e híbrido — Plan Medio

```bash
NEXT_PUBLIC_SATELLITE_PROVIDER=
```

Sin proveedor, la función aparece marcada como *requiere proveedor
configurado*. No se muestra un mapa en blanco ni se finge imaginería.

## Tráfico — Plan Medio

```bash
# mapbox | tomtom | google
TRAFFIC_PROVIDER=
TRAFFIC_API_KEY=
```

**Nunca se genera tráfico ficticio.** Sin proveedor, la capa informa que
requiere configuración. Presentar congestión inventada como real llevaría a
decisiones de despacho equivocadas.

## Ruteo

```bash
# estimated | osrm | mapbox | google | maptiler
ROUTING_PROVIDER=estimated
OSRM_BASE_URL=
```

`estimated` calcula sobre el corredor planificado con velocidad urbana
efectiva. Es honesto: el ETA declara su procedencia (`estimated` frente a
`routing_provider`).

La geometría por calle de las rutas de demostración se precalcula aparte con
`npm run build:rutas`.

## Geocodificación

```bash
# none | nominatim | maptiler | mapbox | google
GEOCODING_PROVIDER=none
```

**Nunca se geocodifica masivamente de forma automática.** Los proveedores
cobran por consulta y limitan la tasa; una base con miles de direcciones podría
generar un costo inesperado o un bloqueo. Se dispara por acción explícita y se
cachea.

## Terreno 3D — Plan Avanzado

```bash
NEXT_PUBLIC_TERRAIN_PROVIDER=
```

## Atribución

Respetar obligatoriamente las atribuciones de OpenStreetMap, MapTiler, Mapbox,
TomTom, Google e IDE Chile según el proveedor en uso. **No retirar los logos ni
los textos exigidos contractualmente.**

Las claves `NEXT_PUBLIC_*` son publicables por naturaleza (el navegador debe
descargar los tiles). Restringirlas por dominio en el panel del proveedor.
