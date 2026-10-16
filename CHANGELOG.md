# Changelog

## 0.2.0

Auditoría completa de 0.0.1a en `AUDITORIA.md` (17 fallos, con su comprobación y su corrección).

### Escaneo «ráfaga»
- Mosaico en el emisor: 1, 2 o 4 QR distintos por pantalla.
- Lectura de varios QR por imagen (`js/workers/multiqr.js`): localiza la pantalla del emisor,
  la divide en celdas con un 4 % de solape y recuerda la cuadrícula que funcionó. jsQR solo no
  leía ninguno cuando había varios códigos.
- `BarcodeDetector` nativo cuando existe; jsQR como alternativa.
- Pool de hasta 3 workers sin cola; `ImageBitmap` transferible cuando el navegador lo permite.
- ROI: tras localizar la pantalla del emisor, se analiza esa zona a resolución nativa.
- HUD con motor, análisis/s, QR/s, latencia y píxeles por módulo, con aviso «acerca la cámara».
- Medido con cámara simulada: 4 QR por pantalla completa el envío en 2,0–2,3 s frente a
  3,4–5,9 s con 1 (ver README).

### Más y mayores archivos
- Varios archivos por envío: paquete SZPK dentro del cifrado; «guardar todo» en ZIP.
- Límite de 8 a 32 MB.
- Tamaños de QR que llenan su versión: S=148 (v8), 225 (v10, por defecto), 374 (v13), 587 (v17),
  794 (v20). El S=200 anterior dejaba el 10 % del v10 sin usar.
- Recompresión opcional de fotos a WebP.
- GIF y bolsas con `leanCount` (K + 25 % + 2) en vez del margen de cámara: ~18 % más pequeños.
- El GIF se desactiva por encima de 3000 fotogramas.

### Robustez y rendimiento
- Variantes por sesión+K+S+L: un fotograma manipulado ya no bloquea el envío legítimo.
- Cada fotograma se decodifica una sola vez; los textos repetidos de la cámara se descartan.
- `allFrames()` sin spread (fallaba con ~130 000 fotogramas).
- base45 con tabla de consulta y búfer preasignado; el decodificador fountain no copia símbolos
  que ya no aportan.
- Comprobación del tamaño declarado al ensamblar.
- Wake lock al emitir y al escanear; linterna y enfoque continuo cuando la cámara los ofrece.
- Migración de claves de IndexedDB de 0.1.0.

### Interfaz
- Terminal cyberpunk compacta: barra de estado tipo tmux, pestañas `1:dex 2:scan 3:send` con
  atajos de teclado, listado tipo `ls`, mapa de fragmentos en vivo, registro de terminal.
- Formulario de envío con estimación de tiempo, pantalla completa para el emisor.
- Detalle con lista de archivos, vista previa por archivo y ZIP.

### Sin cambios de formato
- Fotograma v1, cifrado, fuente LT, base45, bolsa y GIF compatibles con 0.0.1a y 0.1.0.

## 0.1.0
- Interfaz mobile-first; jsQR en un Web Worker; captura con `requestVideoFrameCallback`.
- IndexedDB en vez de `localStorage`, con migración; service worker y manifiesto.
- Corrección de la etiqueta de conexión invertida; cámara y carrusel se detienen fuera de su vista.

## 0.0.1a
- Primera versión: AES-256-GCM, fuente LT sistemática, base45, GIF propio, bolsas `.szb`,
  Pokédex en `localStorage`.
