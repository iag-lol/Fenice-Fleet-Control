# Seguridad de Fleet Control

La administración exige sesiones y permisos en el servidor. Los roles del navegador no autorizan operaciones. En Render, `AUTH_ENABLED=false` o la ausencia de la clave de cifrado impiden arrancar la aplicación.

## Configuración del servidor

- `AUTH_ENABLED=true` en producción. Mantener desactivados los datos de demostración.
- `APP_ALLOWED_ORIGINS`: orígenes HTTPS completos de la aplicación, separados por coma. Se validan protocolo, dominio y puerto; no se confía en `X-Forwarded-Host` para autorizar escrituras.
- `DATA_ENCRYPTION_KEY`: 32 bytes aleatorios codificados en Base64. Guardarla en las variables privadas del servidor y respaldarla fuera de Git.
- `DATA_ENCRYPTION_PREVIOUS_KEYS`: claves anteriores separadas por coma, necesarias mientras queden archivos, registros o copias cifradas con ellas.
- `DRIVER_PORTAL_SECRET`: secreto aleatorio persistente de firma. Cambiarlo invalida los enlaces del conductor existentes.

No registrar claves, contraseñas, cookies ni enlaces completos en logs. No incluir `.fenice`, archivos de entorno o informes privados en el repositorio ni en el artefacto del servidor.

## Cifrado y recuperación

AES-256-GCM protege los archivos GPS (historial y última ubicación), los nombres/documentos/comentarios de receptores y las fotografías de evidencias almacenadas en la base interna. Cada escritura usa un IV aleatorio y un contexto autenticado para detectar manipulación o sustitución entre registros.

Las contraseñas se guardan como bcrypt; las sesiones, como hashes SHA-256 de tokens aleatorios. Son hashes, no datos recuperables mediante descifrado. El cifrado de campos no reemplaza HTTPS, permisos ni la protección de las cuentas de infraestructura. No se modifica la base externa de ventas/clientes de la empresa.

Para migrar archivos GPS anteriores, detener todos los escritores y ejecutar:

```sh
NODE_ENV=production node --conditions=react-server --import tsx scripts/encrypt-gps-history.ts
```

El comando verifica cada descifrado antes de reemplazar el archivo. Ante un fallo, no borrar el original ni eliminar la clave anterior. Reanudar los escritores solo después de verificar la migración. Para rotar, agregar la clave antigua a `DATA_ENCRYPTION_PREVIOUS_KEYS`, configurar la nueva clave principal y recifrar los archivos. No eliminar una clave mientras existan evidencias o backups que la necesiten. Respaldar datos y claves por separado y probar su restauración.

## Seguimiento compartido

El número de OT ya no permite consultar ubicaciones anónimamente. En la ficha de la OT, los botones de vista de cliente y copia emiten un enlace opaco válido por 72 horas. Los enlaces anteriores por número deben regenerarse. Una entrega cerrada deja de compartir la posición según las reglas operacionales. Quien tenga un enlace vigente puede usarlo: compartir solo con el destinatario autorizado.

Los enlaces de conductor son firmados, caducos y registrados en un ledger privado. Una consulta fallida, un enlace no registrado o una revocación impiden acceder. Las paradas se autorizan dentro de la ruta del token.

## Verificación y operación

- Aplicar las migraciones versionadas de bloqueo atómico de login; las funciones son `SECURITY INVOKER`, con ejecución exclusiva de `service_role`.
- Mantener RLS y revocar permisos públicos en las tablas internas, también en los objetos nuevos. Los avisos informativos de RLS sin políticas corresponden al modelo de acceso exclusivo del backend; no crear políticas públicas para quitarlos.
- La cookie de producción usa el prefijo `__Host-`, `Secure`, `HttpOnly`, `SameSite=Lax`, ruta `/` y ausencia de `Domain`. El cambio exige iniciar sesión nuevamente.
- Render recibe el tráfico público mediante Cloudflare. Se usa la IP de esa capa, no el primer valor de `X-Forwarded-For`. Si cambia la arquitectura del proxy, revisar y volver a probar este control antes de desplegar.
- CSP con nonce por documento bloquea scripts inline arbitrarios; los estilos inline se conservan para MapLibre. El HTML privado y la API usan `no-store`.
- Los límites de cuerpos también se aplican a transferencias fragmentadas. Los servidores GPS introducidos en formularios deben coincidir con el endpoint autorizado del entorno y no siguen redirecciones.

Pendientes operacionales que requieren atención: doble factor para administradores y cuentas de infraestructura; respaldo y restauración periódica; supervisión de logs e incidentes; almacenamiento persistente del historial en producción. El rate limit general reside en memoria de cada instancia y debe centralizarse antes de escalar a múltiples instancias. Una revisión no constituye una garantía de ausencia de vulnerabilidades futuras.
