# Transmisión y recorridos GPS

La torre recibe posiciones por SSE y pasa a consultas HTTP si el stream falla, deja de publicar durante 30 segundos, o el navegador recupera su conexión. Conserva la última posición para orientación, pero señala cuando no hay una medición reciente. Un fallo de red o de alimentación del dispositivo no se puede evitar desde la web; la fecha de la medición es la evidencia de frescura.

## Por calles

Configurar `OSRM_BASE_URL` con un servicio OSRM propio que incluya la región en que opera la flota. Cada transición válida de hasta 60 segundos se consulta al servicio Match. Solo se anima por su geometría si hay una coincidencia única de confianza ≥ 0,8, dentro de 35 m de ambos puntos y con velocidad plausible. Con incertidumbre, cortes de señal o sin OSRM, la vista conserva la muestra GPS recibida y no dibuja una trayectoria intermedia inventada. Las coordenadas medidas nunca se sobrescriben con el ajuste visual.

## Grabación y consulta

La API de historial consulta primero la fuente del equipo. Los vehículos vinculados individualmente a Traccar consultan el historial del servidor y dispositivo enlazados. La aplicación también archiva las muestras recibidas en JSONL privado, por vehículo y día. `GPS_HISTORY_DIR` debe apuntar a un volumen persistente con respaldo; la carpeta local `.fenice/gps-history` sirve para desarrollo y no garantiza conservación en alojamientos con disco efímero. Las muestras se capturan mientras se consulta la web y también mediante `npm run gps:record`, que debe funcionar como proceso de servicio supervisado para cubrir los periodos sin operadores conectados. El archivo guarda la medición original y, si existe, el ajuste vial como dato visual separado. El historial del proveedor puede completar periodos que el grabador no vio durante un corte, según las capacidades y políticas de retención contratadas.

En la ficha del vehículo, «Recorridos guardados» permite elegir hasta 72 horas, reproducir por tiempo, saltar a detenciones y descargar un CSV de las muestras. Los periodos sin datos se muestran como cortes. Ninguna distancia de un corte se suma al recorrido. El visor y la API mantienen acceso a fechas anteriores mientras el proveedor o el archivo conserven muestras.

## Requisitos de operación

1. Configurar el proveedor GPS real y vincular cada dispositivo. La prueba «Conectar GPS» exige una posición válida de los últimos tres minutos; una posición antigua no aparece como transmisión activa.
2. En el equipo, permitir ubicación en segundo plano, evitar que el ahorro de batería cierre el rastreador y activar el almacenamiento sin conexión para reenviar muestras al volver la red. [Traccar Client documenta el búfer local](https://www.traccar.org/traccar-client-sdk/).
3. Configurar `OSRM_BASE_URL` para el ajuste vial y `GPS_HISTORY_DIR` en almacenamiento persistente. Ejecutar `npm run gps:record` bajo un gestor de procesos que lo reinicie al fallar. La web por sí sola no puede mantener activo un equipo apagado ni garantizar el tiempo de conservación de un proveedor externo.
