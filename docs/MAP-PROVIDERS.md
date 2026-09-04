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

TomTom tiene el nivel gratuito mas generoso para este uso: **200.000
consultas al mes, sin tarjeta de credito**, y Chile figura con cobertura
confirmada de Flow e Incidents.

### Como se reparte la cuota

Nuestra implementacion consulta el tramo donde esta CADA camion, no un mosaico
de teselas, asi que el gasto crece con la flota.

La cuota NO se reparte entre los 43.200 minutos del mes. Se concentra en la
jornada de despacho declarada (por defecto lunes a viernes, 08:00 a 19:00):
15.180 minutos utiles, mas del triple de presupuesto por minuto. Fuera de esa
ventana no se consulta nada.

| Flota | Intervalo | Consultas/mes | Uso de la cuota |
|---|---|---|---|
| 10 camiones | 60 s | 151.800 | 76 % |
| 12 camiones | 75 s | 145.728 | 73 % |
| 20 camiones | 120 s | 151.800 | 76 % |
| 30 camiones | 165 s | 165.600 | 83 % |
| 50 camiones | 270 s | 168.667 | 84 % |

El intervalo lo calcula el sistema solo, a partir de la flota que este
reportando. Se reserva un 15 % de margen para reintentos, pruebas y los meses
de 23 dias habiles: agotar la cuota a mitad de mes dejaria la operacion sin
trafico justo cuando mas se usa.

Al terminar la jornada el mapa conserva el ultimo trafico conocido en lugar de
vaciarse, porque un mapa que pierde el trafico al dar las 19:00 parece
averiado.

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
