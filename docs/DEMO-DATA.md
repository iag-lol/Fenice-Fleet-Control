# Datos de demostración

Cómo funciona el mundo de demostración y **cómo eliminarlo por completo**.

## Eliminar toda la información de demostración

Una sola operación:

```bash
npm run demo:purge
```

Escribe `DEMO_MODE=false` y `NEXT_PUBLIC_DEMO_MODE=false` en `.env.local`,
descarta la geometría de rutas precalculada y limpia la compilación.

A partir de ahí la plataforma **no sirve ni un dato ficticio**: muestra sus
estados vacíos y espera a que se conecten las fuentes reales.

No hay que revisar archivo por archivo. Que eso fuera necesario es exactamente
lo que este comando existe para evitar.

Para volver a empezar con un mundo limpio:

```bash
npm run demo:reset      # descarta el mundo y la geometría cacheada
npm run build:rutas     # recalcula las rutas por calle
```

## Por qué basta con una variable

Todo el acceso pasa por una única puerta:
[`src/demo/index.ts`](../src/demo/index.ts).

```
Interfaz
  ↓
Provider (contrato)
  ↓
MockProvider  /  RealProvider
  ↓
src/demo/index.ts  /  fuente real
```

Con `DEMO_MODE=false`, `getDemoDataset()` devuelve un mundo vacío. Es
preferible una pantalla vacía y honesta a una llena de camiones que no existen.

**Ningún componente importa `/demo` directamente.** Verificable:

```bash
grep -rn "from '@/demo" src/components src/app   # sin resultados
```

El vocabulario del negocio (tipos de camión, segmentos de cliente, densidades
del combustible) vive en [`src/lib/fuel-domain.ts`](../src/lib/fuel-domain.ts),
**fuera** de `/demo`: sigue siendo válido cuando la demostración desaparezca.

## Qué contiene

Distribución de combustible en la Región Metropolitana.

| | |
|---|---|
| Clientes | ~597 en las 52 comunas, con estado comercial escalonado |
| Camiones | 12 cisterna (semirremolque, rígido y camioneta estanque) |
| Rutas | 9–11 diarias, con geometría real por calle |
| Productos | Diésel B, gasolinas 93/95/97, kerosene, petróleo N6, AdBlue |

**Restricciones reales respetadas:** ninguna ruta despacha más litros de los
que carga el estanque (95 % útil, el resto es cámara de expansión), ni más
grados distintos que compartimentos tiene el camión.

## Determinismo

La misma semilla produce siempre el mismo mundo. Sin esto, las cifras bailarían
entre recargas y la demostración perdería credibilidad.

Una consecuencia sutil, documentada en el código: la geometría de rutas
cacheada **no puede** alterar el consumo del generador pseudoaleatorio. El
trazado sintético se construye siempre aunque se descarte, porque saltárselo
desplazaría la secuencia y cambiaría los clientes de las rutas siguientes,
invalidando la propia caché.

## El simulador

Mueve cada camión por su corredor, se detiene en las geocercas, provoca
desvíos y pierde señal ocasionalmente. Precarga 2,5 h de historial y avanza con
el tiempo real transcurrido, no con la hora del día: así la demostración se ve
viva a cualquier hora.

Se pausa desde el encabezado. El indicador `GPS: DEMO` está siempre visible.
