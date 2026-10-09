# Alertas y notificaciones de Fenice

La aplicación ofrece alertas en vivo, avisos del sistema y sonido. Instalar la aplicación no concede automáticamente permiso para notificaciones.

## Activar y probar en cada equipo

1. Abre `https://fleet.fenice.cl` e inicia sesión.
2. Entra a **Alertas → Notificaciones de este equipo**. También hay un acceso desde la campana.
3. Pulsa **Activar notificaciones** y permite los avisos del navegador/sistema.
4. Usa **Enviar prueba al sistema**. El equipo confirma recepción y presentación del aviso; confirma tú que se oye el sonido.
5. Usa **Probar tono de Fenice** para comprobar el sonido con la aplicación abierta.
6. Ajusta gravedad, sonido y privacidad. El detalle está oculto por defecto en la pantalla bloqueada.

Las notificaciones quedan vinculadas a la sesión actual. Cerrar sesión, revocar acceso o vencer la sesión cancela los avisos pendientes de ese equipo. Una nueva sesión vuelve a vincular el dispositivo cuando se mantienen los avisos activados. El límite es 10 equipos activos por usuario.

## Plataformas

| Plataforma | Requisitos |
|---|---|
| Windows | Chrome o Edge actualizado; instalar desde el navegador y permitir notificaciones del navegador/aplicación en Windows |
| Android | Chrome u otro navegador compatible con Web Push; instalar la aplicación y permitir avisos y sonido |
| Mac | Safari compatible o Chrome/Edge actualizado; permitir notificaciones del navegador/app en macOS |
| iPhone/iPad | iOS/iPadOS 16.4 o posterior; añadir Fenice a la pantalla de inicio, abrir la app instalada y activar avisos desde un gesto del usuario |

El sistema operativo decide el tono de las notificaciones, vibración, presentación y restricciones de fondo. La web no puede imponer un tono personalizado ni saltarse silencio, concentración, volumen, permisos o restricciones empresariales. El tono de Fenice se reproduce con la app abierta después de una interacción del usuario. Si el navegador está completamente detenido, el equipo está apagado o no hay conectividad, la entrega depende del sistema; confirmar con la prueba del equipo.

Fuentes oficiales: [Apple/WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/), [Microsoft Edge](https://learn.microsoft.com/en-us/microsoft-edge/progressive-web-apps/how-to/notifications-badges), [Notifications API](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/showNotification).

## Funcionamiento del servidor

- Canal SSE autenticado con revisión cada 5 segundos, reconexión y consultas alternativas. La sesión se revalida durante el stream.
- Evaluación de telemetría y reglas en un proceso supervisado por la aplicación Next.js, independiente de los navegadores. Usa la frecuencia GPS configurada, con mínimo de 10 segundos.
- Envío Web Push desde una cola privada, evaluada cada 5 segundos. No requiere contratar otro servicio para el servidor persistente actual.
- Los eventos nuevos se registran en una transacción junto con sus destinatarios. Una subida de gravedad o reapertura genera una revisión nueva; no hay envíos duplicados por repetir una inserción.
- Solo recibe una suscripción habilitada de un usuario activo y una sesión vigente. Se vuelve a validar justo antes de enviar.
- Reintentos acotados ante errores de red, 429 o 5xx; se desactivan endpoints vencidos con 404/410. Se utilizan leases para coordinar procesos y se conserva el estado tras reiniciar.
- Un envío aceptado por el servicio push no se confunde con recepción: el service worker registra `recibida_at` y `mostrada_at` tras recibir y presentar el aviso.
- Los eventos de más de 15 minutos quedan en el centro, pero no se vuelven a enviar como un lote histórico. Las notificaciones usan TTL acotado.

El worker evalúa falta de posición reciente, recuperación, eventos expresamente reportados por el GPS, desvíos/comunas/detenciones con historial continuo fiable, atrasos/asignaciones/direcciones de OT y umbrales comerciales cuando existe información real. Las geocercas conservan los controles de evidencia existentes. Sin lecturas o accesorios no se inventan alarmas, combustible, movimientos, visitas ni colisiones. La entrega push admite todas las categorías y tipos almacenados.

## Seguridad y configuración

Ejecutar `node scripts/setup-web-push.mjs` una sola vez para preparar claves VAPID en archivos privados. No reemplaza claves existentes ni imprime valores. Guardar en el servidor:

```dotenv
WEB_PUSH_PUBLIC_KEY=CLAVE_PUBLICA
WEB_PUSH_PRIVATE_KEY=CLAVE_PRIVADA
WEB_PUSH_SUBJECT=https://fleet.fenice.cl
ALERT_WORKER_ENABLED=true
```

Se requiere `AUTH_ENABLED=true`, Supabase y `DATA_ENCRYPTION_KEY`. Los endpoints y claves de suscripción se cifran con AES-256-GCM. Las dos tablas nuevas tienen RLS y acceso exclusivo del backend; sus funciones SQL son SECURITY INVOKER y no se ejecutan con claves públicas. El navegador solo recibe la clave pública VAPID. No publicar archivos de entorno, suscripciones, credenciales ni pruebas privadas.

Migraciones aplicadas: `operational_push_notifications`, `notification_device_receipts` y `notification_subscription_limits_and_logout`. El esquema completo incluye estas correcciones. No hay SQL pendiente de esta entrega.

## Validación y límites

Pruebas automatizadas: filtros, revisiones, privacidad, reintentos, endpoints permitidos/SSRF, reglas conservadoras, desbloqueo del audio y service worker. Pruebas transaccionales en la base: cola, escalada, lease, usuario desactivado, logout, cambio de sesión y máximo de dispositivos; se revirtieron los registros de prueba.

La validación física debe registrarse por dispositivo. Una prueba en Chrome/macOS no certifica una prueba física en iOS, Android o Windows. Usar la prueba integrada tras instalar en cada equipo, incluida una prueba con la ventana cerrada y otra con el equipo bloqueado.

Auditoría de dependencias: 0 vulnerabilidades conocidas de producción en la consulta realizada. La auditoría completa detectó el aviso sin parche GHSA-vfj7-8cjw-p6xm en `braces`, transitivo de herramientas de desarrollo/compilación; no se exponen patrones glob a la API. Mantener controlados los inputs de compilación y revisar su corrección al actualizar dependencias. [Aviso oficial](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm).
