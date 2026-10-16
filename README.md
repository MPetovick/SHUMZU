# SHUMZU v0.1.0

Transferencia de archivos cifrados **sin servidor ni cuenta**, de forma airgap: el archivo
sale como códigos QR (en pantalla, en un GIF o en una captura) y se reconstruye al otro lado
escaneando. Los fotogramas también pueden relevarse por red mesh, en bolsas `.szb`.

Novedades de la 0.1.0 (detalle en `CHANGELOG.md`): interfaz mobile-first, decodificación en Web
Worker, captura con contrapresión, persistencia en IndexedDB y funcionamiento sin conexión.
**El formato de fotograma no cambia**: lo que enviaba 0.0.1a se lee aquí y viceversa.

## Uso

**Enviar.** Elige el archivo (máx. 8 MB), escribe una contraseña (mín. 8 caracteres) y pulsa
*Preparar envío*. Verás un carrusel de QR. Desde ahí puedes descargar un **GIF** con todos los
códigos (se puede reenviar por cualquier app) o una **bolsa `.szb`** para relevo en malla.

**Capturar.** Activa la cámara y apunta a los QR, o arrastra un GIF o capturas de pantalla
a la zona de importación. Cada fotograma nuevo se registra. Los fotogramas pueden llegar en
cualquier orden, repetidos o con huecos: el código fuente los aprovecha igualmente.

**Pokédex.** Cada envío es una entrada con su número, su origen (QR, GIF, IMG…) y el progreso
de captura. Cuando una entrada está completa, ábrela, escribe la contraseña y revisa el
archivo: texto, imagen, audio, vídeo o PDF se muestran en vista previa, con verificación
SHA-256 antes de mostrarlo. Los fotogramas se guardan en IndexedDB de este dispositivo; si
IndexedDB no está disponible, se guardan sólo en memoria. El contenido descifrado sólo existe
mientras la pestaña está abierta.

Para ejecutarla, sirve la carpeta con cualquier servidor estático (la cámara exige HTTPS o
`localhost`):

```sh
npm start        # python3 -m http.server 8080
```

No hay paso de compilación. Librerías en `vendor/`: `qrcode` 1.5.4 (MIT, empaquetada como
IIFE) y `jsQR` 1.4.0 (Apache-2.0, licencia en `vendor/jsQR.LICENSE`). `qrcode` también es
dependencia de desarrollo para los tests.

## Estructura

```
index.html                 interfaz (una página, tres vistas)
css/styles.css             tokens, diseño mobile-first, modo claro/oscuro
js/app.js                  estado, Pokédex, envío, detalle, vista previa
js/visual.js               generación de QR (caché LRU) y bucle de la cámara
js/scan.js                 importación de GIF / imágenes
js/decoder.js              cliente del worker de decodificación
js/workers/decode.worker.js  jsQR fuera del hilo principal
js/store.js                persistencia en IndexedDB (lotes de 120 ms)
js/core/*.js               códec: cifrado, formato, fuente LT, base45, GIF, bolsas
sw.js                      service worker (caché primero, sólo recursos propios)
manifest.webmanifest       instalable
vendor/                    qrcode.bundle.js (IIFE), jsQR.js (UMD)
test/                      node:test
```

## Formato

```
archivo ─► cabecera (nombre, tipo, tamaño, SHA-256) ─► deflate si reduce
        ─► AES-256-GCM (PBKDF2-SHA256, 310 000 iteraciones, sal = id de sesión)
        ─► K bloques de S bytes ─► código fuente LT, sistemático al principio
        ─► fotograma binario ─► base45 ─► QR nivel L (modo alfanumérico)
```

**Fuente sistemática.** Los K primeros fotogramas llevan cada bloque en claro (semilla = índice);
después vienen combinaciones aleatorias para recuperar lo que se pierda. Escaneando en orden
basta con K fotogramas (medido en 0.0.1a: 1,00 frente a 1,3–1,7 de la fuente LT pura).

### Fotograma (binario, big-endian)

| offset | tamaño | campo                                           |
|-------:|-------:|-------------------------------------------------|
| 0      | 2      | magia `SZ`                                      |
| 2      | 1      | versión de formato (`1`)                        |
| 3      | 1      | banderas: bit0 cifrado, bit1 deflate            |
| 4      | 16     | id de sesión (también sal de PBKDF2)            |
| 20     | 4      | K, número de bloques                            |
| 24     | 2      | S, bytes por bloque                             |
| 26     | 4      | L, longitud real del flujo cifrado              |
| 30     | 4      | semilla: índice del fotograma                   |
| 34     | S      | carga = XOR de los bloques indicados            |
| 34+S   | 4      | CRC-32 de todo lo anterior                      |

Con S=200: 238 bytes → 357 caracteres base45 → **QR versión 9**, nivel L. La cabecera ocupa
38 bytes por fotograma (≈ 11–16 % según S); una cabecera compacta es posible pero exige un
formato 2 y no está en esta versión.

### GIF de QR

Cada fotograma del GIF es un código centrado, en 2 colores, 4 píxeles por módulo y zona de
silencio de 4 módulos. El codificador y el decodificador LZW son propios (`js/core/gif.js`);
el decodificador acepta GIF externos, incluidos entrelazado y disposición de fotogramas.

### Bolsa `.szb`

`"SZB1"` · u32 número de fotogramas · por cada uno: u16 longitud + fotograma. Los fotogramas
son autodescriptivos (sesión + semilla) y se deduplican por `(sesión, semilla)`. No contienen
nada en claro: un intermediario puede reenviarlos sin conocer la contraseña.

## Medidas

| S (B) | Caracteres por QR | Versión QR (L) | Fotogramas enviados por bloque |
|------:|------------------:|---------------:|-------------------------------:|
| 120   | 237               | 8              | 1,5 (+8)                       |
| 200   | 357               | 9              | 1,5 (+8)                       |
| 300   | 507               | 11             | 1,5 (+8)                       |

`recommendedCount` = `⌈1,5·K⌉ + 8` fotogramas (K=1 → 3). Medido en 0.0.1a en navegador: un texto
de 2 KB genera 11 fotogramas, y el GIF resultante pesa 40 KB para ~3 KB de contenido.

Las cifras de rendimiento de la 0.1.0 (tiempo de decodificación, fotogramas por segundo de
captura, uso de memoria) **aún no están medidas**; se obtendrán con el Chromium headless y, sobre
todo, en un móvil real.

## Seguridad

- Cifrado autenticado (AES-GCM). Una contraseña incorrecta se detecta al final y no entrega datos.
- Nombre y tipo van **dentro** del cifrado. En claro sólo viajan K, S, L y el id de sesión.
- Cada sesión tiene sal y clave propias; el IV fijo a cero es seguro porque una clave cifra un solo mensaje.
- La vista previa sólo muestra imágenes raster, audio, vídeo y PDF; SVG y HTML se descargan, nunca se renderizan.
- El texto de los archivos se inserta siempre con `textContent`.
- El service worker sólo cachea recursos del mismo origen; nunca cachea datos del usuario.

**Limitaciones:** no hay firma de origen (quien tenga la contraseña puede crear un envío válido);
K y L son visibles, así que el tamaño aproximado del archivo no se oculta; el relevo por bolsa
no protege contra fotogramas malintencionados (sólo se pierde disponibilidad).

## Pruebas

```sh
npm test      # node --test: 15 pruebas
npm run check # sintaxis de todos los módulos de la aplicación
```

- `test/roundtrip.test.mjs`: base45, formato y CRC, transmisión sin pérdidas en orden aleatorio,
  30 % de pérdida, duplicados, contraseña incorrecta, texto base45, relevo por bolsas.
- `test/gif.test.mjs`: codificador y decodificador de GIF con rachas y con ruido (fuerza reinicios LZW),
  cadena completa archivo → QR → GIF → jsQR → archivo idéntico, y la misma con 25 % de fotogramas perdidos.

Estado de verificación de la 0.1.0:

- **Verificado en Node:** los tests del núcleo (15/15) y la sintaxis de todos los módulos.
- **Verificado en Chromium headless (390 px, sin errores de consola):** arranque sin
  desbordamiento horizontal; decodificación en el worker (`importScripts` de jsQR) de un QR
  generado con la librería empaquetada; envío de un archivo de texto con salida de 357 caracteres
  por fotograma (S=200) que el worker vuelve a leer desde el canvas; importación de un QR como
  imagen y su persistencia en IndexedDB tras recargar; migración de una bolsa de `localStorage`
  (0.0.1a) a IndexedDB, con borrado de la clave legada; registro del service worker, caché
  `shumzu-v0.1.0` y recarga sin red.
- **No verificado:** la cámara real en un móvil y el rendimiento medido (tiempos, fotogramas por
  segundo de captura, memoria). Los GIF entrelazados y con disposición sólo tienen prueba de
  lectura básica. Un GIF con varios QR en el mismo fotograma no se soporta.
- Nota: el emisor no añade el envío a la Pokédex; sólo se registran los fotogramas que se
  capturan, como en 0.0.1a.

## Pendientes

- Licencia: `LICENSE` es MIT **provisional**. Confirmar antes de publicar.
- `package-lock.json` se regeneró con `npm install` (mismas versiones de dependencias); revisar
  que no haya cambios no deseados frente a la versión 0.0.1a.
- Límite de 8 MB; archivos mayores necesitan otro esquema de sesiones.
- Reencodificar fotos a WebP antes de cifrar (ahorro grande en imágenes, con pérdida).
- Cabecera compacta (formato v2) con compatibilidad hacia atrás.
- Parámetros por defecto (S, iteraciones PBKDF2) a validar en un móvil real.
