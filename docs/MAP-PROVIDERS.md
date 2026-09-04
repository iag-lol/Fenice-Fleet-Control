# Proveedores de mapa

## Vistas disponibles SIN clave

Las cuatro vistas funcionan sin contratar nada:

| Vista | Fuente | Clave |
|---|---|---|
| **Estandar** | OpenStreetMap, desaturado | No |
| **Satelite** | Esri World Imagery | No |
| **Hibrido** | Esri World Imagery + capa de referencia (calles, nombres, limites) | No |
| **Nocturno** | OpenStreetMap con tratamiento oscuro | No |

El modo hibrido superpone la capa de referencia sobre la imagineria. Sin ella
el satelite es bonito pero inutil para operar: nadie reconoce una direccion
sin el nombre de la calle.

### Mejorar la nitidez (opcional)

Con `NEXT_PUBLIC_MAPTILER_KEY` o `NEXT_PUBLIC_MAPBOX_TOKEN` el satelite pasa a
teselas VECTORIALES, mas nitidas al acercarse y mas livianas. No hace falta
para tener satelite; solo lo mejora.

---

## Trafico en tiempo real

**No existe ninguna fuente de trafico sin clave.** Ni Google, ni TomTom, ni
HERE, ni Mapbox: todas exigen registro y facturan por uso. Google Maps en
particular no es gratuito — requiere una cuenta con facturacion activa.

Por eso el control de trafico se muestra pero declara que necesita un
proveedor configurado, en lugar de dibujar congestion inventada. Un mapa que
finge trafico haria replanificar rutas contra una realidad que no existe.

### Activarlo

```bash
TRAFFIC_PROVIDER=tomtom
TRAFFIC_API_KEY=<clave>
```

TomTom tiene el nivel gratuito mas generoso para este uso. El proveedor ya
esta implementado: solo hay que poner la clave.

---

## Cambiar el mapa base

`NEXT_PUBLIC_MAP_PROVIDER` acepta `osm` (por defecto), `carto-light`,
`maptiler` o `mapbox`.

CARTO **exige clave** aunque sus teselas respondan 200: sin ella devuelven la
imagen con la marca de agua "API KEY REQUIRED" incrustada.

---

## Nota sobre las teselas de Google

Existen endpoints de Google (`mt.google.com/vt/lyrs=s`) que devuelven
imagineria satelital sin clave. **No se usan aqui**: sus condiciones de
servicio no permiten consumirlas fuera de sus propias APIs, y una demanda por
uso indebido de cartografia no es un riesgo que valga la pena para ahorrar
una clave. Esri publica su imagineria justamente para este uso, con
atribucion.
