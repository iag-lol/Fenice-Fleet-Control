# Límites comunales oficiales de Chile

Los polígonos de comuna **no están dibujados a mano ni aproximados**. Provienen
de la División Político Administrativa oficial del Estado de Chile.

## Fuente

Relaciones de límite administrativo de nivel 8 de OpenStreetMap, filtradas por
región. Cada relación lleva la etiqueta `dpachile:id`, que es el **código
oficial de la DPA**:

```
13123  Providencia
13125  Quilicura
13119  Maipú
```

Eso ancla la geometría a la nomenclatura del Estado en lugar de a nombres
escritos a mano, que se equivocan y se desactualizan.

## Importar

```bash
npm run import:comunas
```

Consulta Overpass, ensambla los polígonos a partir de los tramos de cada
relación, los simplifica y los escribe versionados en
`src/data/communes-rm.json` junto a su fuente, licencia y fecha.

Otra región:

```bash
REGION_ISO=CL-VS REGION_NAME="Región de Valparaíso" REGION_SLUG=v npm run import:comunas
```

Se importa **fuera del arranque** a propósito: la plataforma levanta al
instante, funciona sin conexión y no golpea un servicio público en cada inicio.

## Resultado actual

| | |
|---|---|
| Región | Metropolitana de Santiago |
| Comunas | 52 (la cifra oficial) |
| Vértices | 8.611 tras simplificar |
| Peso | 309 KB |
| Licencia | ODbL — © colaboradores de OpenStreetMap |

## Detección de comuna

[`getCommuneForPoint(lat, lng)`](../src/data/administrative-boundaries.ts)
resuelve por **geometría**, nunca por texto: el nombre de comuna de una
dirección es dato de captura y puede estar mal.

Dos optimizaciones que importan cuando se resuelve la comuna de cada posición
GPS de la flota:

- **Descarte por caja envolvente** antes de evaluar punto-en-polígono.
- **Caché** con clave redondeada a cuatro decimales (~11 m).

## Rendimiento

La geometría comunal **no viaja en `/api/map`**: pesa cientos de kilobytes y su
capa viene desactivada. Se sirve aparte en `/api/comunas`, junto al resumen
operacional de cada comuna, y solo cuando el operador enciende la capa.

## Sustituir la cartografía

Para pasar a la del IDE Chile, vector tiles o PostGIS: reemplazar
`administrative-boundaries.ts`. El resto de la plataforma consume
`@/data/communes`, que es un punto de acceso estable — ningún motor ni
componente cambia.

## Atribución

OpenStreetMap exige atribución bajo ODbL. Se muestra en el mapa y **no debe
retirarse**.
