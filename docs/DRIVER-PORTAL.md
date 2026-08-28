# Portal del conductor

Pantalla que el conductor abre en su telefono para ver su jornada y cerrar
cada parada. Es la unica superficie de la plataforma pensada para usarse en
movimiento, y la unica —junto al seguimiento publico— accesible sin pasar por
la aplicacion interna.

Plan: **Medio**. En Plan Basico la ruta `/conductor` devuelve 404 real (no una
pagina que dice "no disponible") y la API rechaza cualquier enlace.

---

## 1. Como accede el conductor

No hay usuario ni contrasena. La central genera un enlace desde el detalle de
la ruta (`/rutas/[routeId]` → **Enlace para el conductor**) y lo envia por el
canal que ya usa la operacion.

```
https://.../conductor/ruta/v1.<ruta>.<vencimiento>.<aleatorio>.<firma>
```

El enlace **es** la credencial. De ahi las propiedades que se le exigen:

| Propiedad | Como se consigue |
|---|---|
| No adivinable | 16 bytes aleatorios por enlace |
| No falsificable | HMAC-SHA256 sobre ruta + vencimiento + aleatorio |
| Caduco | Vencimiento firmado dentro del propio enlace |
| Revocable | Lista de anulados en el servidor |
| Acotado | Solo abre UNA ruta |

Cambiar la ruta o estirar la fecha dentro del enlace invalida la firma. La
comparacion es en tiempo constante, para no filtrar cuantos bytes acerto quien
prueba.

Codigo: [`src/services/drivers/route-token.ts`](../src/services/drivers/route-token.ts).

### Clave de firma

`DRIVER_PORTAL_SECRET` (minimo 16 caracteres). **Si no se define, el proceso
genera una aleatoria al arrancar**: los enlaces siguen siendo seguros pero
dejan de valer en cada reinicio y no funcionan entre instancias. Es aceptable
en demostracion y deliberadamente molesto en produccion.

Rotar la clave invalida TODOS los enlaces vigentes. Es el corte de emergencia.

---

## 2. Que ve y que no ve

Ve unicamente las paradas de su ruta: cliente, direccion, comuna, ventana
horaria, productos, litros y compartimento, mas un contacto de terreno para
avisar que llego.

No ve la flota, ni otras rutas, ni otros conductores, ni datos comerciales del
cliente (precios, historico, deuda, segmento).

El aislamiento no depende de lo que pida el navegador: la parada se busca
**dentro** de la sesion que abre el token
([`findOwnStop`](../src/services/aggregation/driver-route-aggregator.ts)). Un
identificador de otra ruta responde 404.

---

## 3. Cierre de una parada

Dos resultados posibles, y ninguno admite quedarse a medias:

- **Entregada** — exige quien recibe. Opcionalmente litros descargados,
  documento, comentario y hasta cuatro fotografias.
- **Incidencia** — exige un motivo de una lista cerrada (cliente ausente, sin
  acceso, estanque lleno, rechazo, documentacion, problema del vehiculo,
  condiciones de seguridad, direccion incorrecta, otro). Lista cerrada y no
  texto libre para poder contar cuantas veces pasa cada cosa.

Se registra ademas la **posicion del telefono** al firmar, que es
independiente del GPS del camion, y la distancia a la direccion declarada. No
bloquea la entrega —el GPS del telefono falla dentro de naves y bajo
estructuras metalicas— pero queda como dato para revision.

### Fotografias

Se comprimen **en el telefono** antes de subirlas: lado maximo 1280 px, JPEG
0,72, bajando calidad por pasos si aun excede el limite. Una foto de 5 MB
queda en torno a 200 KB. El cuello de botella es la subida por red movil, no
el procesamiento.

El servidor solo acepta imagenes en linea (`data:image/...`), nunca URLs
remotas, y verifica el tamano real recibido en vez de fiarse del declarado.

---

## 4. Trabajo sin conexion

En terreno la senal se cae. **Una entrega declarada no puede perderse porque
el envio fallo.**

1. Lo declarado se escribe primero en el almacenamiento del telefono.
2. Despues se intenta enviar.
3. Si falla, queda en cola y se reintenta solo al recuperar senal
   (evento `online`) o en el siguiente refresco.
4. Al confirmarse, sale de la cola.

La cola se guarda bajo una clave derivada del token, no del token en claro:
el enlace es la credencial y no tiene por que quedar legible en el navegador.
Dos conductores en el mismo telefono no mezclan jornadas.

Un almacenamiento corrupto o sin cuota **no bloquea** la pantalla: se degrada
a trabajar sin persistencia entre recargas y se avisa en la interfaz.

Codigo: [`offline-queue.ts`](../src/features/medium/driver-portal/offline-queue.ts).

### Idempotencia

El servidor es idempotente por orden de trabajo. Reenviar la misma evidencia
devuelve la ya registrada (`duplicate: true`, HTTP 200) en vez de crear una
segunda entrega. **La primera declaracion es la que vale**: un reenvio no la
reescribe, porque permitirlo dejaria reescribir la historia desde el telefono.

Ese contrato es lo que permite que la cola reintente sin miedo.

Los rechazos 4xx salen de la cola —el servidor no los aceptara nunca— y solo
los fallos de red y los 5xx se reintentan. Sin esa distincion, una parada
ajena se reintentaria en bucle para siempre.

---

## 5. Instalacion como aplicacion (PWA)

`/conductor.webmanifest` permite instalar el portal en la pantalla de inicio.
El trabajador de servicio (`/conductor-sw.js`) tiene alcance `/conductor/`: no
toca la aplicacion de oficina ni el seguimiento publico.

**Solo cachea el armazon.** Ninguna respuesta de `/api/` se guarda nunca.
Servir datos de ruta desde cache haria que una parada ya entregada apareciera
como pendiente y el conductor volviera a ella. Lo que sostiene el trabajo sin
conexion es la cola, no el cache.

---

## 6. Efecto en el resto del sistema

Lo declarado por el conductor se superpone a lo que dice la fuente operacional
mediante un decorador del proveedor
([`driver-declaration-overlay.ts`](../src/services/operations/driver-declaration-overlay.ts)),
no dentro de una implementacion concreta: la regla es del dominio y vale igual
con datos de demostracion que con la base real de Fenice.

Existe por dos razones:

1. La base de Fenice es de **solo lectura**. La declaracion es un artefacto de
   esta plataforma y no puede escribirse alli, pero si debe verse en toda la
   aplicacion.
2. **La declaracion humana pesa mas que la inferencia.** Si el GPS no alcanzo
   a confirmar la permanencia pero el conductor firmo, la entrega ocurrio. Y
   si el conductor reporto una incidencia, la parada NO esta entregada aunque
   el camion estuviera dentro de la geocerca.

Consecuencias inmediatas de firmar una entrega:

- La OT pasa a `completada` con `deliveryConfirmation: 'driver'`.
- La parada se cierra en la ruta.
- **El seguimiento publico deja de devolver la posicion del vehiculo.** Ver
  [GEOFENCE-DELIVERY.md](./GEOFENCE-DELIVERY.md).

Una parada cancelada no se reabre por una declaracion posterior.

---

## 7. Endpoints

| Metodo | Ruta | Quien | Para que |
|---|---|---|---|
| `GET` | `/api/conductor/ruta/[token]` | Conductor (enlace) | Su jornada |
| `POST` | `/api/conductor/ruta/[token]/paradas/[workOrderId]` | Conductor (enlace) | Cerrar una parada |
| `POST` | `/api/rutas/[routeId]/enlace-conductor` | Central (`ordenes.editar`) | Emitir enlace |
| `DELETE` | `/api/rutas/[routeId]/enlace-conductor?token=` | Central (`ordenes.editar`) | Anular enlace |

Los rechazos responden **404** casi siempre, para no confirmarle a quien
prueba tokens si acerto el formato, la firma o la ruta. La unica excepcion es
**410** en un enlace vencido: ahi el conductor legitimo necesita saber que
debe pedir uno nuevo, y quien no lo tiene tampoco aprende nada util.

---

## 8. Configuracion

| Variable | Por defecto | Efecto |
|---|---|---|
| `DRIVER_PORTAL_SECRET` | aleatoria por proceso | Clave de firma de los enlaces |
| `DRIVER_TOKEN_TTL_HOURS` | `16` | Vigencia del enlace (jornada + margen) |
| `PROOF_MAX_PHOTOS` | `4` | Fotografias por parada |
| `PROOF_PHOTO_MAX_BYTES` | `900000` | Tope por fotografia ya comprimida |
| `DELIVERY_DETECTION_MODE` | `hybrid` | Si la entrega la confirma el GPS, el conductor o ambos |

---

## 9. Persistencia

La evidencia vive hoy en memoria del proceso
([`proof-store.ts`](../src/services/deliveries/proof-store.ts)), que es
suficiente para demostracion y validacion pero **se pierde al reiniciar**.

Al conectar la base propia de la plataforma (`DATABASE_URL`) solo cambia el
respaldo de ese modulo: su interfaz (`recordDeliveryProof`, `getProof`,
`listProofs`) ya es la que usa el resto del sistema. Las fotografias deberian
pasar entonces a almacenamiento de objetos, guardando en base solo la
referencia.
