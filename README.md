# SHUMZU v0.2.0

Transferencia de archivos cifrados **sin servidor ni cuenta**, de forma airgap: los archivos salen
como códigos QR (en pantalla, en un GIF o en una captura) y se reconstruyen al otro lado
escaneando. Los fotogramas también pueden relevarse en bolsas `.szb`.

Novedades de la 0.2.0 (detalle en `CHANGELOG.md`; fallos de 0.0.1a en `AUDITORIA.md`):

- **Escaneo «ráfaga»:** varios QR por pantalla (mosaico de 1, 2 o 4), lectura de todos a la vez,
  pool de workers, detector nativo del sistema cuando existe y recorte automático a la pantalla
  del emisor a resolución nativa.
- **Más y mayores archivos:** varios archivos por envío (paquete cifrado, «guardar todo» en ZIP),
  límite de 8 a 32 MB y QR que llenan su versión (+12,5 % de datos por QR con el mismo código).
- **Interfaz terminal compacta** con mapa de fragmentos en vivo.
- **Robustez:** un fotograma manipulado en un relevo ya no bloquea el envío legítimo.

**El formato de fotograma no cambia** (v1): 0.0.1a y 0.1.0 leen lo que emite 0.2.0 y viceversa.
Un envío de varios archivos llega a una versión antigua como un único archivo `.szpk`.

## Uso

**send.** Elige uno o varios archivos (32 MB en total), escribe una clave (mín. 8 caracteres),
elige el tamaño de QR y cuántos por pantalla, y pulsa *preparar envío*. La estimación muestra el
tiempo mínimo. Opcionalmente, las fotos JPEG/PNG se recomprimen a WebP (con pérdida, mucho
menos tiempo). Desde el carrusel puedes ponerlo a pantalla completa, exportar un **GIF** (hasta
3000 fotogramas) o una **bolsa `.szb`**.

**scan.** Activa la cámara y apunta a la pantalla del emisor, o importa GIF, capturas (con uno o
varios QR) o bolsas. El HUD muestra el motor, los análisis por segundo, los QR por segundo y los
píxeles por módulo; si avisa «acerca la cámara», acércala. El mapa enciende cada bloque recibido.

**dex.** Cada envío es una fila con su progreso. Cuando está completo («clave»), ábrelo, escribe
la clave y revisa el contenido: vista previa de texto, imagen, audio, vídeo o PDF tras verificar
el SHA-256. Con varios archivos puedes ver o guardar cada uno, o todos en un ZIP. Atajos de
teclado: `1`, `2`, `3`.

Para ejecutarla, sirve la carpeta con cualquier servidor estático (la cámara exige HTTPS o
`localhost`):

```sh
npm install      # solo para los tests
npm test         # 26 pruebas
npm start        # python3 -m http.server 8080
```

No hay paso de compilación. Librerías en `vendor/`: `qrcode` 1.5.4 (MIT, IIFE) y `jsQR` 1.4.0
(Apache-2.0, licencia en `vendor/jsQR.LICENSE`).

## Cómo es tan rápido el escaneo

1. **Mosaico.** El emisor muestra 2 o 4 QR distintos por pantalla: cada pantalla lleva 2 o 4 veces
   más datos con la misma frecuencia de refresco, que suele ser el cuello de botella real.
2. **Lectura de varios QR.** jsQR no lee nada si hay varios códigos en la imagen. SHUMZU localiza
   la zona clara de la pantalla del emisor, la divide en celdas (1×2, 2×1 o 2×2, con un 4 % de
   solape) y decodifica cada una; recuerda la cuadrícula que funcionó.
3. **Detector nativo.** Donde existe `BarcodeDetector` (Chrome Android, ChromeOS, macOS) se usa ese,
   acelerado por el sistema y capaz de leer todos los QR de una vez.
4. **ROI a resolución nativa.** El primer análisis va reducido (960 px); en cuanto se localiza la
   pantalla del emisor, se recorta esa zona sin reducir: más píxeles por módulo y menos píxeles
   totales.
5. **Pool sin cola.** Hasta 3 workers; un fotograma de cámara solo se envía si hay uno libre.
   Cuando el navegador lo permite, los fotogramas pasan como `ImageBitmap` transferible, sin
   `getImageData` en el hilo principal; si no, se usa un lienzo como antes.
6. **Fuente sistemática y sin repeticiones.** Los K primeros fotogramas son los bloques en claro;
   después, combinaciones nuevas sin fin: cualquier fotograma nuevo sirve.

### Medidas con cámara simulada

Vídeo Y4M con desenfoque y ruido inyectado como cámara en Chromium headless. Contenedor de
**2 núcleos** (un solo worker, entorno de gama baja). Envío de 6,5 KB (K=30 bloques, S=225, v10),
emisor a 10 pantallas/s. Tiempo hasta completar, contando el arranque de la cámara; todas las
pasadas descifraron correctamente.

| Escenario | 1 QR/pantalla | 2 QR | 4 QR |
|---|---:|---:|---:|
| Cámara 1920×1080, pantalla del emisor a 460 px | 3,4 s · 7,1 px/mód | 2,8–3,4 s | **2,0–2,1 s** · 3,5 px/mód |
| Cámara 1080×1920, pantalla del emisor a 648 px | 4,6–5,9 s · 10 px/mód | — | **2,3 s** · 5 px/mód |

Lectura sostenida: 6–14 QR/s con 1 por pantalla y 18–39 QR/s con 4. «—»: el simulador de Chromium
recorta el vídeo vertical a 1080×1080 y corta el mosaico vertical de 2; no es un fallo de la app.

**No medido:** cámaras reales (enfoque, moiré, reflejos, pulso), el detector nativo (no existe en
Chromium para Linux) y dispositivos con más núcleos.

## Tamaños de QR

Cada tamaño es el máximo que cabe en su versión (nivel L, modo alfanumérico), medido con la
librería `qrcode`:

| Preset | S (bytes) | Caracteres | QR | Módulos | Carga útil |
|---|---:|---:|---:|---:|---:|
| v8 | 148 | 279 | 8 | 49 | 80 % |
| v10 (por defecto) | 225 | 395 | 10 | 57 | 86 % |
| v13 | 374 | 618 | 13 | 69 | 91 % |
| v17 | 587 | 938 | 17 | 85 | 94 % |
| v20 | 794 | 1248 | 20 | 97 | 95 % |

## Formato

```
archivo(s) ─► [paquete SZPK si son varios] ─► cabecera (nombre, tipo, tamaño, SHA-256)
          ─► deflate si reduce ─► AES-256-GCM (PBKDF2-SHA256, 310 000 iteraciones, sal = sesión)
          ─► K bloques de S bytes ─► fuente LT sistemática ─► fotograma ─► base45 ─► QR nivel L
```

### Fotograma (binario, big-endian, sin cambios desde 0.0.1a)

| offset | tamaño | campo |
|-------:|-------:|---|
| 0 | 2 | magia `SZ` |
| 2 | 1 | versión de formato (`1`) |
| 3 | 1 | banderas: bit0 cifrado, bit1 deflate |
| 4 | 16 | id de sesión (también sal de PBKDF2) |
| 20 | 4 | K, número de bloques |
| 24 | 2 | S, bytes por bloque |
| 26 | 4 | L, longitud real del flujo cifrado |
| 30 | 4 | semilla |
| 34 | S | carga = XOR de los bloques indicados |
| 34+S | 4 | CRC-32 |

### Paquete multiarchivo (dentro del cifrado)

`"SZPK"` · u8 versión · u32 número · por archivo: u16 + nombre UTF-8 · u8 + tipo · u32 tamaño ·
datos. Tipo MIME del envío: `application/x-shumzu-pack`.

### Bolsa `.szb`

`"SZB1"` · u32 número de fotogramas · por cada uno: u16 longitud + fotograma. Se deduplican por
variante (sesión+K+S+L) y semilla; no contienen nada en claro.

### Almacenamiento local

IndexedDB `shumzu` / `frames`, una fila por fotograma con clave `sesión.K.S.L:semilla`. Las claves
de 0.1.0 (`sesión:semilla`) y el `localStorage` de 0.0.1a se migran solos al arrancar.

## Seguridad

- Cifrado autenticado (AES-GCM). Una clave incorrecta se detecta al final y no entrega datos.
- Nombres, tipos y lista de archivos van **dentro** del cifrado. En claro: K, S, L y la sesión.
- Un fotograma manipulado (misma sesión, otros parámetros) abre una variante aparte, marcada con
  ≠ en la lista, en vez de bloquear el envío legítimo.
- La vista previa solo muestra imágenes raster, audio, vídeo y PDF; SVG y HTML se descargan.
- El service worker solo cachea recursos propios, nunca datos del usuario.

**Limitaciones** (ver `AUDITORIA.md`): cabecera sin autenticar y PBKDF2 fijo en 310 000 iteraciones
(cambiarlo exige formato v2); sin firma de origen; el tamaño aproximado del envío es visible.

## Pruebas

- `test/roundtrip.test.mjs` y `test/gif.test.mjs` (de 0.0.1a, sin cambios).
- `test/v020.test.mjs`: versión QR real de cada tamaño, archivo de 12 MiB, recuento ajustado para
  GIF/bolsa con un 8 % de pérdida, variantes envenenadas, paquete multiarchivo (también a través
  del cifrado), ZIP, mosaicos 2×2 y 1×2, mosaico dentro de un encuadre de cámara, base45 optimizado
  y 150 000 fotogramas en el almacén.

Verificado además en Chromium headless (390 px y 1280 px, sin errores de consola): envío de dos
archivos en mosaico de 4, lectura de los 4 QR de una captura del emisor, bolsa, descifrado, ZIP
validado con Python (contenido idéntico byte a byte), migración de claves de IndexedDB de 0.1.0,
service worker y recarga sin red, y la cámara simulada de la tabla anterior.

## Pendientes

- Licencia: `LICENSE` es MIT **provisional**. Confirmar antes de publicar.
- Probar con cámaras reales y medir el detector nativo en Android.
- Formato v2: cabecera autenticada (AAD), parámetros de derivación en cabecera, cabecera compacta.
- Fuente RaptorQ (RFC 6330) para reducir la sobrecarga con pérdidas.
- Multiplexado por color (3 QR en los canales R, G y B): ×3 teórico, frágil con cámaras reales.
