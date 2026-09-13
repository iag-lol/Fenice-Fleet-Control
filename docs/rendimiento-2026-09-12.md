# Rendimiento de la torre de control — 12 de septiembre de 2026

Se redujo el trabajo del mapa y de sus proveedores conservando los datos, capas, filtros y fichas de detalle.

## Cambios

- El seguimiento dejaba un bucle de animación permanente incluso con el vehículo detenido. Ahora termina al alcanzar la posición y arranca con nuevos datos o cambios de selección. Durante el movimiento actualiza el GeoJSON hasta 30 veces por segundo. La interpolación temporal, la cámara y la estela permanecen disponibles.
- Seleccionar una comuna actualiza su estado visual sin reenviar todos los polígonos al worker.
- El centro y los límites iniciales del mapa usan metadatos pequeños. Los polígonos completos permanecen en su fuente y en `/api/comunas`, pero ya no se incluyen también en el JavaScript inicial. Los límites se regeneran antes del desarrollo, la compilación y al importar comunas; una prueba verifica que coincidan exactamente con la cartografía.
- Las fichas de vehículo, cliente, comuna, pedido y entidad se cargan al abrirlas. Los cálculos de capas dependen de sus datos concretos y el mapa evita renderizados provocados únicamente por el panel contenedor.
- `/api/map` reutiliza las alertas y geocercas de su contexto. El resumen comunal reutiliza sus alertas. Posiciones HTTP y SSE reutilizan una sola lectura GPS para construir posiciones y estados de vehículos, sin introducir una caché que retrase los datos.
- El polling GPS y la publicación SSE evitan solicitudes superpuestas cuando el proveedor responde lento. El polling cancela la petición pendiente al cerrar la suscripción.

## Medición del JavaScript inicial

Suma de archivos JS únicos del layout y de cada página en `app-build-manifest.json`, comprimidos individualmente con gzip. No incluye CSS, teselas, workers, respuestas de API ni módulos de detalle diferidos. No es una medición de LCP o del tiempo hasta que el mapa está listo.

| Página | Antes, bytes gzip | Después, bytes gzip | Reducción |
| --- | ---: | ---: | ---: |
| Torre de control | 566.648 | 486.268 | 14,2 % |
| Territorio | 524.515 | 457.544 | 12,8 % |

La referencia inicial se tomó del build existente. Durante el trabajo había cambios de interfaz de otra sesión en el mismo repositorio; por ello estas diferencias describen los builds completos y no un experimento que aísle cada modificación.

Para repetir la medición después de compilar:

```sh
node scripts/measure-client-bundle.mjs
```

## Validación y límites

- 455 pruebas aprobadas en 34 archivos; incluye límites de animación en pantallas de 60/120/144 Hz, reposo, cancelación, red lenta, recuperación GPS, lecturas únicas y conservación de datos georreferenciados.
- TypeScript, ESLint y compilación de producción aprobados. La compilación se realizó en una copia temporal para no interrumpir el servidor de desarrollo activo.
- Instancia de producción local con DEMO explícita y fuentes en memoria: HTTP 200 en torre, territorio, archivos de worker, mapa, comunas y posiciones. El stream SSE entregó un evento válido de posiciones. Se verificaron 12 vehículos, 572 clientes georreferenciados, 48 geocercas, 52 comunas y 9 posiciones; las posiciones coincidían con las de sus fichas de vehículo.
- Graphify actualizado. Los datos de prueba y su configuración se mantuvieron aislados de la operación.
- Sin trazas de Chrome DevTools disponibles en esta sesión: falta medir interacción visual, LCP/INP y rendimiento con la red y los proveedores reales. Estas comprobaciones no equivalen a una validación visual ni a un despliegue en producción.
