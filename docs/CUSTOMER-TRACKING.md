# Seguimiento publico del cliente

`/seguimiento?ref=<numero>` — sin login, por diseno. Es la unica superficie
sin autenticacion que expone datos operacionales, y por eso su proyeccion es
deliberadamente minima.

---

## 1. Que se expone y que no

**Se expone:** estado del pedido, avance, direccion de destino, hora estimada,
y —solo mientras el pedido esta en curso— la posicion del vehiculo con una
etiqueta anonimizada (`C-104 · KY••39`).

**No se expone nunca:**

- Otros clientes ni otras ordenes de trabajo
- La ruta completa del camion ni su historial
- Datos comerciales, telefonos o informacion interna
- La patente completa del vehiculo

---

## 2. No es un oraculo de numeros de pedido

Una referencia inexistente y una demasiado corta responden lo mismo: **404**.
Si una devolviera 400 y otra 404, el endpoint permitiria enumerar numeros de
pedido validos probando.

Toda respuesta lleva `Cache-Control: no-store`.

---

## 3. La barra de avance no miente

Un pedido en transito **no puede** mostrar 100 %: le diria al cliente que ya
lo recibio. Los tramos estan acotados:

| Tramo | Tope |
|---|---|
| Despachado | desde 0,12 |
| En camino | hasta 0,85 |
| En destino | 0,94 |
| Entregado | 1,00 |

Solo el estado entregado llega al final.

---

## 4. Corte tras la entrega

En cuanto la entrega queda registrada, el backend **deja de devolver** la
posicion del vehiculo y la ETA, y el estado publico pasa a "Entregado".
No es ocultacion visual: recargar no la recupera.

La pantalla muestra entonces la hora de entrega y explica que el seguimiento
termino, en lugar de dejar un mapa vacio que parece una falla.

Detalle y verificacion en [GEOFENCE-DELIVERY.md](./GEOFENCE-DELIVERY.md) §5.

---

## 5. Etiqueta de estado

El estado que ve el cliente refleja la **entrega**, no el estado interno. Si
la entrega ya fue detectada mientras el camion sigue descargando dentro del
perimetro, se dice "Entregado": mostrar "el vehiculo llego a destino" con el
seguimiento ya cortado dejaria al cliente sin entender por que desaparecio el
mapa.
