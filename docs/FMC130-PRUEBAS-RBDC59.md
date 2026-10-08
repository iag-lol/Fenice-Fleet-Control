# Pruebas e instalación del FMC130 en RBDC59

El primer camión es **RBDC59** y la primera instalación está prevista para el **viernes 9 de octubre de 2026**, hora de Chile. La cadena de datos es FMC130 → SIM → 3DTracking → Fleet Control. El IMEI del primer equipo ya está identificado en el registro privado de puesta en marcha y asociado a RBDC59.

Client API ya autentica y devuelve RBDC59, su IMEI y su última posición. La unidad quedó activa en el proveedor. La última muestra comprobada es del 7 de octubre; la aceptación en terreno requiere una muestra reciente, pruebas de ignición y un recorrido. El acceso público y la persistencia de flota en Supabase siguen pendientes; esta validación corresponde al servidor local.

## Preparación antes del viernes

| Dato o recurso | Estado o acción |
|---|---|
| Patente | RBDC59, confirmada |
| Equipo | Teltonika FMC130 |
| IMEI | Identificado en API; cotejar los 15 dígitos con la etiqueta física |
| Cuenta API | Client API configurada; acceso a catálogo, posición e historial comprobado |
| Unidad en 3DTracking | RBDC59, activa y asociada al equipo confirmado |
| Destino del hardware | Solicitar a 3DTracking el dominio/IP, puerto, transporte y codec de recepción |
| SIM | Confirmar activación, datos móviles, operador y APN; registrar número e ICCID |
| Configurador | Llevar un equipo Windows compatible, cable Micro USB de datos y el Configurator indicado para el firmware |
| Instalador | Confirmar alimentación, protección, masa, ignición y ubicación del equipo |

El **dominio de la API web no es el destino de los paquetes del GPS**. Tampoco se debe usar el puerto 5027 de Traccar para este piloto: el receptor lo define 3DTracking. No ejecutar comandos SMS con valores de ejemplo.

Teltonika documenta configuración en Windows y drivers COM para x64 Intel/AMD; conviene llevar ese equipo para la puesta en marcha. La SIM debe colocarse con alimentación externa y batería interna desconectadas. [Primer inicio del FMC130](https://wiki.teltonika-gps.com/view/FMC130_First_Start).

## Configuración de Fleet Control

Usar [.env.fmc130.example](../.env.fmc130.example) como referencia y completar los valores en `.env.local` o en el gestor de secretos del servidor. Conservar las credenciales de otros servicios.

```dotenv
GPS_PROVIDER=3dtracking
TRIDTRACKING_BASE_URL=https://apiv2.3dtracking.net
TRIDTRACKING_API_MODE=client
TRIDTRACKING_USERNAME=<usuario API autorizado>
TRIDTRACKING_PASSWORD=<clave API>
GPS_LIVE_TRANSPORT=polling
GPS_REFRESH_INTERVAL_MS=15000
GPS_HISTORY_DIR=.fenice/gps-history
DEMO_MODE=false
NEXT_PUBLIC_DEMO_MODE=false
```

Reiniciar el servidor después de configurar credenciales. En producción, `GPS_HISTORY_DIR` debe apuntar a un volumen persistente con respaldo. Para abrir la plataforma por internet, configurar Supabase, el administrador y `AUTH_ENABLED=true` según [la guía de Supabase](SUPABASE-INTEGRATION.md). Las credenciales API permanecen en el servidor.

```bash
nvm install
nvm use
npm ci
npm run verify
npm run gps:check -- --plate RBDC59
npm run gps:check -- --plate RBDC59 --imei <IMEI_REAL> --history
npm run build
npm start
```

`gps:check` consulta la cuenta y el camión; no crea unidades ni asociaciones. Devuelve código 1 si falta configuración, posición reciente, ignición conocida o acceso al archivo de recorridos. Antes de tener hardware es normal que termine como pendiente.

En **Configuración → Integración GPS / 3DTracking**, pulsar **Probar 3DTracking** con RBDC59. Agregar el IMEI cuando esté disponible y seleccionar la comprobación de recorrido después de comenzar a transmitir. La tarjeta verifica acceso, unidad, posición e ignición. La sección **Conectar GPS / Traccar** corresponde a otro proveedor; las unidades de 3DTracking se incorporan desde la cuenta del proveedor.

## Perfil propuesto para las pruebas del FMC130

Estos valores son un punto de partida para el piloto y deben guardarse y comprobarse en el Configurator. No son un archivo binario listo para importar ni sustituyen el perfil de 3DTracking.

La API no permite demostrar qué APN, firmware, destino GPRS o perfil de reposo tiene cargado físicamente el FMC130. Leer el perfil del equipo con el Configurator o contrastarlo con el instalador antes de dar esa configuración por confirmada. En un camión de 24 V, revisar especialmente la fuente de ignición: el rango de voltaje de fábrica 13,2–30 V puede mantenerse activo con el motor apagado. La prueba debe contrastar apagado, encendido y arranque con la señal instalada.

| Parámetro | Valor propuesto para el piloto |
|---|---|
| APN y autenticación SIM | Los entregados por el operador |
| Host, puerto, transporte y codec | Los confirmados por 3DTracking para FMC130 |
| Registro en movimiento | Cada 15 segundos; agregar distancia y giro según la ruta de prueba |
| Registro detenido | Cada 30 segundos, también durante la prueba de motor apagado |
| Send Period | 15 segundos |
| Min Saved Records | 1 |
| Modos Home, Roaming y Unknown | Revisar los tres; un operador no clasificado puede activar Unknown |
| Ignition Source | DIN1 si se instala una señal de ignición verificada |
| Reposo | Evitar que el perfil de reposo suspenda la transmisión durante la prueba; luego ajustar consumo en estacionamiento |
| Hora | Sincronización UTC; la interfaz presenta hora de Chile |

El equipo distingue la creación de registros de su envío; ambos intervalos deben revisarse. Teltonika documenta modos por operador y registros por tiempo, distancia, giro y cambio de velocidad. [Adquisición de datos del FMC130](https://wiki.teltonika-gps.com/view/FMC130_Data_acquisition_settings).

Con una cadencia distinta a la del piloto hay que ajustar los umbrales de salud GPS: por defecto 60 segundos significa retraso, 180 pérdida y 600 offline. El perfil de fábrica puede espaciar mucho los reportes detenido, por lo que no sirve para comprobar estos umbrales sin ajustarlo. [Manual rápido del FMC130](https://wiki.teltonika-gps.com/images/5/55/QM-FMC130.pdf).

La detección de ignición puede usar DIN1, voltaje, RPM o acelerómetro. Para la prueba propuesta se usa una señal física verificada; si hay varias fuentes habilitadas, una sola puede activar el estado. [Configuración del sistema FMC130](https://wiki.teltonika-gps.com/view/FMC130_System_settings).

## Instalación del viernes

El instalador debe verificar el sistema eléctrico del camión y el pinout de su arnés antes de conectar. El FMC130 admite alimentación de 10 a 30 V DC: pin 1 VCC, pin 7 GND y pin 5 DIN1. Ubicarlo en la cabina según las indicaciones de montaje, protegido y con recepción GNSS; verificar que la señal de ignición se mantiene al arrancar. [Conexión y montaje oficiales](https://wiki.teltonika-gps.com/view/FMC130_First_Start).

1. Fotografiar etiqueta, IMEI, SIM y posición del equipo. Registrar instalador, firmware y hora.
2. Confirmar RBDC59 e IMEI en 3DTracking y acceso de la cuenta API.
3. Guardar el perfil en el equipo y exportar una copia de la configuración.
4. Probar detenido al aire libre hasta recibir un fix válido en 3DTracking y en Fleet Control.
5. Probar motor apagado y encendido; contrastar físicamente el estado con la ficha.
6. Recorrer un trayecto corto con detención y retorno. Un operador observa el mapa.
7. Consultar el recorrido de la última hora y contrastar los puntos inicial y final.
8. Comprobar recuperación de registros tras un corte controlado de conectividad, sin borrar datos del equipo ni del proveedor.
9. Dejar el grabador GPS funcionando y registrar el resultado de aceptación.

## Criterios de aceptación

| Prueba | Resultado requerido |
|---|---|
| Identidad | Una sola unidad RBDC59; IMEI coincide con la etiqueta |
| Posición | Coordenadas reales, reloj coherente y última muestra con menos de 60 segundos durante el perfil de prueba |
| Movimiento | Velocidad en km/h y rumbo consistentes con el trayecto |
| Ignición | Encendido y apagado coinciden con la prueba física |
| Detención | Siguen llegando muestras durante el perfil de prueba |
| Pérdida de señal | El sistema indica retraso/pérdida/offline sin inventar movimiento |
| Reconexión | Se reciben muestras nuevas y se recuperan registros pendientes |
| Historial | Conserva el inicio y el final del recorrido; no muestra puntos de otro vehículo |
| Archivo | Se conserva el recorrido tras reiniciar el grabador usando el mismo volumen y cuenta |
| Geocerca de prueba | Entrada y salida coherentes en una zona conocida, si se configura para el piloto |

No provocar excesos de velocidad ni maniobras peligrosas para probar alertas. Los casos extremos se cubren con las pruebas automatizadas.

## Grabación sin operadores conectados

Ejecutar `npm run gps:record` como proceso supervisado en el servidor. Guarda muestras aunque nadie tenga abierto el mapa y se detiene limpiamente con SIGTERM o Ctrl C. El historial del proveedor permite recuperar muestras durante un corte, sujeto a sus permisos y retención.

[Ejemplo de servicio systemd](../ops/fenice-gps-record.service.example): adaptar usuario, ruta del proyecto y binario Node antes de instalarlo. No está activado automáticamente. Un despliegue con disco efímero o funciones de corta duración necesita un grabador separado con volumen persistente.

## Recepción de los ocho FMC130 adicionales

El lote previsto suma nueve equipos. Las pruebas de software incluyen nueve unidades simultáneas, identidad local por IMEI, separación de sus posiciones e historiales y actualización del catálogo al incorporar las ocho nuevas. Son pruebas con datos ficticios; la cuenta real sigue teniendo un equipo.

1. Registrar por equipo: patente, IMEI de la etiqueta, SIM/ICCID, firmware, instalador y fecha. Cada IMEI y UID de proveedor debe identificar una sola unidad; no reutilizar el registro de RBDC59.
2. Asignar cada unidad a la cuenta accesible por el mismo usuario API y darle su patente como nombre. Confirmar su estado activo en 3DTracking.
3. Aplicar el perfil aprobado tras el piloto, conservando los identificadores y la SIM propios de cada equipo. Exportar una copia de configuración por IMEI.
4. Confirmar su aparición en Flota: el catálogo se renueva cada 60 segundos y la consulta de posiciones es conjunta para todos los equipos, con caché compartida de al menos 15 segundos.
5. Ejecutar `npm run gps:check -- --plate <PATENTE> --imei <IMEI> --history` después del recorrido. Repetir los criterios de aceptación de esta guía para cada camión.
6. Mantener el grabador supervisado y el volumen persistente. No considerar la posición guardada como una instalación validada si la consulta actual del proveedor está fallando.

Los ocho equipos pendientes no se crean con IMEIs o patentes ficticios en la cuenta real. La preparación del software no sustituye el alta y las pruebas físicas de cada dispositivo.

## Diagnóstico rápido

| Síntoma | Revisar |
|---|---|
| Cuenta no conecta | URL API, usuario, clave y disponibilidad de 3DTracking |
| Unidad no aparece | Alta, nombre RBDC59 y permisos sobre esa unidad |
| Unidad sin posición | Alimentación, SIM/APN, host/puerto, codec, GNSS y frecuencia de envío |
| Posición antigua | Cadencia, reposo, cobertura y reloj del equipo |
| IMEI distinto | Asociación patente–equipo en 3DTracking |
| Mapa vacío con unidad presente | Fix válido y acceso a latestpositionslist |
| Recorrido vacío o error | Permiso sobre positionslist, rango de fechas y servicio grabador |
| Ignición desconocida | DIN1, fuente de ignición y mapeo del proveedor para FMC130 |

## Verificación del software

Auditoría del 8 de octubre de 2026: **648 pruebas aprobadas**, TypeScript y ESLint sin errores y compilación de producción correcta. Se comprobaron nueve equipos simultáneos con datos de prueba, separación de posiciones e historial, altas nuevas, rechazo de UID/IMEI duplicados, reemplazo de GPS y bloqueo de aceptación cuando se usan datos guardados tras una consulta fallida. La cuenta real autentica y devuelve un equipo, cuyo IMEI coincide con RBDC59; todavía no hay muestra reciente ni recorrido de la última hora para aceptar la instalación.

El grabador local quedó iniciado durante la preparación. Para operación permanente debe ejecutarse como servicio supervisado en el servidor definitivo; el ejemplo systemd no instala ni habilita ese servicio por sí solo.

Verificación del 7 de octubre de 2026: **531 pruebas aprobadas**, TypeScript y ESLint sin errores, compilación de producción correcta y comprobación local de API y pantalla. El diagnóstico sin credenciales devuelve pendiente; un IMEI inválido devuelve 400 y un origen ajeno devuelve 403. Las pruebas incluyen el formato oficial desde autenticación hasta posición e historial archivado. Los datos de esas pruebas son ficticios y no se envían al proveedor.

La auditoría de dependencias de producción (`npm audit --omit=dev`) no reportó vulnerabilidades el 7 de octubre. La auditoría completa conserva siete entradas de severidad alta asociadas a `braces` y sus consumidores de desarrollo, incluidos Tailwind y ESLint; la versión publicada de `braces` no ofrece una corrección compatible. La migración de ese conjunto de herramientas queda pendiente. Los avisos críticos de las herramientas de prueba se corrigieron actualizando Vitest.

## Registro de aceptación

- Fecha y hora de Chile:
- Patente: RBDC59
- IMEI:
- SIM e ICCID:
- Operador y APN:
- UID de 3DTracking:
- Firmware y perfil guardado:
- Instalador y operador de prueba:
- Hora de primera posición válida:
- Resultado de ignición apagada y encendida:
- Inicio y fin de recorrido:
- Resultado de pérdida y recuperación:
- Ubicación del archivo y proceso grabador:
- Observaciones y correcciones pendientes:
- Resultado: aceptado / requiere corrección.

Contrato de integración: [documentación oficial de 3DTracking](https://apiv2.3dtracking.net/docs/v1/) y [OpenAPI v1](https://apiv2.3dtracking.net/openapi/v1.json).


## Revisión de lecturas inconsistentes — 8 de octubre de 2026

La conexión de Client API confirmó RBDC59 e IMEI 865124073408991. Las lecturas consultadas contienen coordenadas, velocidad y contacto, pero no precisión GNSS ni satélites. El historial de prueba presenta desplazamientos entre lecturas de velocidad cero y dos lecturas aisladas de velocidad durante pocos segundos. Esos datos no permiten certificar el recorrido mostrado previamente.

La aplicación conserva el historial recibido, excluye esos intervalos de líneas, distancia, detenciones y visitas, y distingue posición reportada de actividad corroborada por muestras consecutivas. La prueba de regresión reproduce el patrón con coordenadas ficticias; no publica las ubicaciones reales. Ver [política de evidencia](GPS-RECORRIDOS.md).

Pendiente de aceptación física: probar equipo fijo al aire libre, luego un recorrido conocido, comparar timestamps y dispersión, revisar instalación/alimentación y perfil FMC130 con el proveedor. Persisten intervalos largos entre fixes: la comunicación del equipo no reemplaza una medición GNSS reciente. No se ha confirmado ni modificado remotamente el perfil del hardware. No se debe aceptar el piloto como preciso hasta superar esta prueba.


## Auditoría de integración — 8 de octubre de 2026

La consulta de aceptación de software encontró RBDC59, coincidencia de IMEI 865124073408991, ignición conocida, posición reciente e historial de la última hora. Se revisaron las respuestas de GPS, mapa, flota, ficha, configuración, clientes, comunas, órdenes, rutas y publicidad, sin errores de carga. Las credenciales y el modo de simulación se comprobaron sin publicarlas.

Se corrigieron tres fallos de confiabilidad: el uso de una comunicación como fecha de posición cuando faltaba `GPSTimeUtc`; velocidades ausentes o unidades no reconocidas interpretadas como cero/km/h; y una escritura del catálogo que podía reemplazar una ubicación más reciente guardada por el otro proceso. Las pruebas cubren fallos de red, reinicio, cambios de dispositivo, nueve identidades, escritura concurrente y recuperación de bloqueos abandonados. La auditoría de dependencias de producción no reportó vulnerabilidades.

Pendientes concretos de la instalación definitiva: vincular el proyecto correcto de Supabase para persistencia de flota/configuración y login; mantener servidor y grabador bajo supervisión en el alojamiento definitivo; y confirmar con MCI el perfil, frecuencia, firmware y prueba física del FMC130. El grabador local está activo, pero no es un servicio remoto que continúe con el computador apagado. No se han creado dispositivos ficticios en la cuenta para sustituir los ocho equipos aún no recibidos. La conexión API y las pruebas de software no sustituyen la aceptación física del equipo.
