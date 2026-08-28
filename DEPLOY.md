# Publicar la demo para Fenice

Guia para dejar la plataforma accesible por internet y que el cliente pueda
verla desde cualquier dispositivo.

---

## 1. Por que NO sirve GitHub Pages

GitHub Pages solo entrega archivos estaticos. Esta plataforma necesita un
servidor Node corriendo:

| Necesita servidor | Por que |
|---|---|
| 20 rutas de `/api` | Flota, ordenes, rutas, geocercas, seguimiento, portal del conductor |
| `middleware.ts` | Bloquea por plan las pantallas no contratadas con un 404 real |
| `/api/gps/stream` | Posiciones en vivo |
| Proveedores GPS y base de datos | Las credenciales de Traccar y de Fenice **jamas** pueden llegar al navegador |
| Enlaces del conductor | Se firman con HMAC en el servidor |

En Pages quedaria un cascarón sin mapa en vivo, sin seguimiento, sin portal
del conductor y **sin control de acceso por plan**. No es una limitacion que
se pueda rodear: es la diferencia entre servir archivos y ejecutar codigo.

Lo mismo aplica a Netlify Drop, S3 estatico o cualquier hosting de solo
archivos.

---

## 2. Opcion recomendada: Vercel desde GitHub

Vercel es de la misma gente que Next.js: detecta el proyecto solo, no hay que
configurar nada de compilacion, y el plan gratuito basta de sobra para una
demo.

### Paso 1 — Subir el repositorio

El repositorio local ya esta preparado (`git init` hecho, `.gitignore` que
excluye `node_modules`, `.next` y cualquier `.env`).

```bash
# Crea el repositorio en github.com (privado) y luego:
git remote add origin https://github.com/<tu-usuario>/fenice-fleet-control.git
git push -u origin main
```

> El repositorio puede ser **privado**. Vercel lo despliega igual, y la web
> publicada sera accesible aunque el codigo no lo sea.

### Paso 2 — Conectar Vercel

1. Entra en [vercel.com](https://vercel.com) con tu cuenta de GitHub.
2. **Add New… → Project** e importa el repositorio.
3. Framework: detecta **Next.js** solo. No cambies nada de compilacion.
4. Antes de pulsar **Deploy**, abre **Environment Variables** y pega las de la
   seccion 3.
5. **Deploy**. Tarda unos 2 minutos.

Te queda una URL del tipo `fenice-fleet-control.vercel.app`. Cada `git push`
publica sola la nueva version.

---

## 3. Variables de entorno para la demo

Copia y pega tal cual en Vercel. **Ninguna es un secreto**: la demo funciona
enteramente con datos simulados.

```
NEXT_PUBLIC_PRODUCT_PLAN=medium
NEXT_PUBLIC_SHOW_UPSELL=true
NEXT_PUBLIC_SHOW_PLAN_BADGES=true
DEMO_MODE=true

AUTH_ENABLED=false
GPS_PROVIDER=mock
OPERATIONS_PROVIDER=mock

GPS_LIVE_TRANSPORT=polling
GPS_REFRESH_INTERVAL_MS=10000

DRIVER_PORTAL_SECRET=<genera una con: openssl rand -base64 48>
DRIVER_TOKEN_TTL_HOURS=72
```

### Por que `GPS_LIVE_TRANSPORT=polling` en Vercel

Vercel ejecuta cada peticion como una funcion con tiempo maximo. Un stream SSE
se cortaria cada pocos segundos y el navegador reconectaria sin parar,
gastando ejecuciones sin ganar nada. Con `polling` el navegador consulta cada
10 segundos y la experiencia es estable.

En un servidor propio (VPS, Docker, Railway) deja `GPS_LIVE_TRANSPORT=auto`
y usara streaming, que es mejor. El indicador del header muestra siempre el
transporte realmente en uso, sin fingir.

### Por que `DRIVER_PORTAL_SECRET` importa aqui

Sin ella, cada arranque genera una clave aleatoria y **los enlaces del
conductor dejan de valer en cada despliegue**. Con varias instancias, un
enlace emitido por una no lo reconoceria otra. Definela siempre en produccion.

`DRIVER_TOKEN_TTL_HOURS=72` da tres dias de margen para que Fenice pruebe el
portal sin pedirte enlaces nuevos. En operacion real, bajala a 16.

---

## 4. Que vera el cliente

| Pantalla | Ruta |
|---|---|
| Mapa operacional | `/mapa` |
| Torre de control | `/control` |
| Reproduccion de jornada | `/rutas` → una ruta |
| Evidencia de entrega | `/evidencias` |
| Seguimiento del cliente | `/seguimiento` |
| Portal del conductor | Se genera desde el detalle de una ruta |

Para el portal del conductor: entra a `/rutas`, abre una ruta, pulsa **Enlace
para el conductor**, copia y abrelo en un movil.

---

## 5. Aviso de acceso

`AUTH_ENABLED=false`: **no hay login**. Cualquiera con la URL entra a todas
las pantallas de operacion.

Los datos son enteramente ficticios (`DEMO_MODE=true`), asi que no se expone
nada real de Fenice. Pero la URL puede circular. Recomendaciones minimas:

- No enlaces la URL desde ninguna web publica (evita que la indexen). La
  aplicacion ya envia `robots: noindex`, pero eso no impide que alguien la
  comparta.
- Cuando termine la demo, borra el proyecto en Vercel.
- Antes de conectar datos **reales** de Fenice, activa la autenticacion. Toda
  la arquitectura ya esta preparada: ver `src/lib/auth.ts`.

Si en algun momento quieres una clave de acceso para la demo, se resuelve en
`src/middleware.ts` sin tocar el resto del sistema.

---

## 6. Alternativas

| Plataforma | Cuando conviene |
|---|---|
| **Vercel** | Demo y produccion ligera. Cero configuracion. Recomendada |
| **Railway / Render** | Servidor Node continuo: permite SSE de verdad (`GPS_LIVE_TRANSPORT=auto`) |
| **VPS propio + Docker** | Cuando conecteis Traccar y la base de Fenice, si estan en red privada |
| GitHub Pages / S3 | **No sirve.** Ver seccion 1 |

Cuando lleguen los datos reales de Fenice, lo mas probable es que haga falta
un VPS o un servidor dentro de su red: la base de datos de Fenice no suele ser
accesible desde internet. Eso no cambia el codigo — solo las variables de
entorno descritas en `docs/EXTERNAL-DATABASE-INTEGRATION.md`.
