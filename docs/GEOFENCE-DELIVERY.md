# Deteccion de entrega por geocerca

Como el sistema decide que un pedido fue entregado, y por que nunca lo decide
sin dejar constancia de en que se baso.

Es la pieza mas delicada del sistema: de ella dependen el cierre de la orden,
lo que ve el cliente y el corte del seguimiento publico. Una deteccion
equivocada da por entregado lo que no llego.

---

## 1. Principio: evidencia y confirmacion no son lo mismo

El sistema distingue siempre dos cosas:

- **Evidencia** — hechos medidos: el vehiculo entro en la geocerca, permanecio
  N segundos, se acerco a M metros de la direccion.
- **Confirmacion** — la afirmacion de que hubo entrega, con su origen:
  `gps`, `driver`, `admin`, `manual` o `none`.

Pasar por la direccion es evidencia. No es entrega. Un camion puede cruzar la
calle del cliente camino de otro. Por eso `visita_detectada` y `completada`
son estados distintos, y por eso `deliveryConfirmation` guarda **quien** lo
afirmo.

---

## 2. Modos

`DELIVERY_DETECTION_MODE` (por defecto `hybrid`):

| Modo | Condicion |
|---|---|
| `enter` | Basta entrar al radio |
| `dwell` | Hay que permanecer el minimo configurado |
| `driver` | La confirma el conductor desde su portal |
| `hybrid` | Exige presencia GPS **y** confirmacion del conductor |

`enter` es el mas permisivo y solo tiene sentido en geocercas muy ajustadas.
`hybrid` es el recomendado para combustible: la descarga lleva tiempo y hay
una persona que firma.

---

## 3. Orden de las comprobaciones

[`evaluateDelivery`](../src/lib/engines/delivery-detection.ts) rechaza en este
orden, y cada rechazo lleva un motivo:

1. `ya_entregada` — la OT ya fue detectada en este ciclo, o su confirmacion no
   es `none`. **Esta primero: es la barrera de idempotencia.**
2. `orden_cancelada`
3. `sin_vehiculo_asignado`
4. `vehiculo_incorrecto` — hay posiciones de un vehiculo que no es el asignado
5. `sin_geocerca`
6. `geocerca_ajena` — la geocerca no es la declarada para esa OT
7. `sin_posiciones`
8. `nunca_entro`
9. `permanencia_insuficiente`
10. `pendiente_confirmacion_conductor` — en modos `driver` e `hybrid`

Superadas todas, se emite una `DeliveryDetectionEvidence` con: geocerca
aplicada, radio, momento de entrada y salida, permanencia real y exigida,
aproximacion minima, posicion, modo y origen.

**Nunca se cambia el estado de una OT sin ese registro.** Es lo que permite
responderle a un cliente por que su pedido figura entregado.

---

## 4. Idempotencia

Diez posiciones dentro de la geocerca son **una** entrega, no diez. El motor
comprueba primero lo ya detectado y el almacen de evidencia esta indexado por
orden de trabajo. Verificado con 40 posiciones consecutivas dentro del radio:
una sola deteccion.

La misma garantia cubre el reenvio desde la cola sin conexion del conductor.

---

## 5. Corte del seguimiento tras la entrega

**Obligatorio.** En cuanto la entrega queda registrada:

- La API publica deja de devolver la posicion del vehiculo. No es ocultacion
  visual: recargar la pagina o mirar la respuesta cruda no la recupera.
- Tampoco se devuelve la ETA.
- El estado publico pasa a "Entregado" con su hora.

La decision es una sola funcion, `isTrackingAllowed(workOrder)`, y la interfaz
publica se apoya en el mismo `trackingAllowed` que calculo el servidor: si la
pantalla usara su propio criterio, podrian discrepar.

Motivo: a partir de la entrega, donde esta el camion ya no es asunto del
destinatario. Puede ir camino de otro cliente.

Verificado contra el servidor: una OT entregada responde `trackingAllowed:
false`, sin `vehicle`, sin `position` y sin `eta`.

---

## 6. Precedencia entre GPS y conductor

La declaracion del conductor pesa mas que la inferencia del GPS:

| Situacion | Resultado |
|---|---|
| GPS confirma permanencia, conductor no dijo nada (`hybrid`) | Sin entrega: falta la firma |
| Conductor firma, GPS no alcanzo la permanencia | Entregada, origen `driver` |
| Conductor reporta incidencia, camion estuvo dentro | **No entregada**, queda `incidencia` |
| Parada cancelada, conductor firma despues | Sigue cancelada |

Ver [DRIVER-PORTAL.md](./DRIVER-PORTAL.md) §6.

---

## 7. Cuando no hay evidencia

- Ruta terminada con paradas nunca visitadas → `incidencia`, nunca
  `completada`. Marcarlas como entregadas seria declarar entregas que no
  ocurrieron.
- Sin evidencia GPS **no se inventa** una hora de llegada a partir de la
  planificada: seria presentar un plan como si fuera un hecho.
- Una parada en `incidencia` no vuelve a ofrecerse como "proxima parada".

---

## 8. Configuracion

| Variable | Por defecto | Efecto |
|---|---|---|
| `DELIVERY_DETECTION_MODE` | `hybrid` | Regla aplicada |
| `MIN_GEOFENCE_DWELL_TIME` | `60` | Permanencia minima por defecto, en segundos |
| `DEFAULT_GEOFENCE_RADIUS_METERS` | `80` | Radio por defecto |
| `AUTO_CONFIRM_DELIVERY_ON_DWELL` | `true` | Si la permanencia por si sola confirma |

Cada geocerca puede sobreescribir su permanencia minima: en el domicilio de un
cliente interesa la permanencia, en un terminal de carga el exceso de tiempo,
y en una zona restringida basta la entrada.

---

## 9. Pruebas

[`delivery-detection.test.ts`](../src/lib/engines/delivery-detection.test.ts)
cubre los diez rechazos, los cuatro modos, la idempotencia con 40 posiciones,
la trazabilidad completa de la evidencia y el corte del seguimiento para todos
los origenes de confirmacion.
