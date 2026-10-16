# Changelog

## 0.1.0

### Interfaz
- Rediseño mobile-first: navegación inferior fija (Pokédex, Capturar, Enviar), cuadrícula de
  2 columnas en móvil y 3 desde 560 px, detalle como hoja inferior en pantallas pequeñas.
- Tema oscuro por defecto con tokens en `:root`; tema claro según `prefers-color-scheme` o
  el atributo `data-theme`.
- Respeta `prefers-reduced-motion` y las zonas seguras (`env(safe-area-inset-*)`) y usa `dvh`.
- Corrección: la etiqueta de conexión estaba invertida (mostraba «sin conexión» estando en línea).
- Al salir de la vista de captura se detiene la cámara; al salir de Enviar se pausa el carrusel.

### Rendimiento
- La decodificación jsQR se ejecuta en un Web Worker (`js/workers/decode.worker.js`), fuera del
  hilo principal. Los fotogramas se transfieren, no se copian.
- Captura con `requestVideoFrameCallback` y contrapresión: como máximo una decodificación en
  curso, sin acumular cola. Imagen reducida a 720 px en el lado mayor.
- Caché LRU de matrices QR (64 entradas) y dibujo a escala entera de los módulos.
- Las tarjetas de la Pokédex se reutilizan por clave; el renderizado se agrupa con rAF.
- Precálculo de la siguiente matriz QR en tiempo ocioso (`requestIdleCallback`).
- Los fotogramas de la captura se ignoran si son idénticos al último leído.

### Persistencia
- Los fotogramas se guardan en IndexedDB (`shumzu` / `frames`), en lotes de 120 ms y en una
  sola transacción por lote. Antes se usaba `localStorage` con una escritura completa por
  fotograma.
- Migración automática y única desde la clave `shumzu.v1.frames` de `localStorage`.
- Si IndexedDB no está disponible se usa memoria; la aplicación sigue funcionando.

### Sin conexión
- Service worker (`sw.js`, caché `shumzu-v0.1.0`): la aplicación funciona sin red tras la primera
  visita. Las versiones antiguas de caché se borran al activarse.
- Manifiesto web instalable y el icono `icons/icon.svg`.

### Sin cambios de formato
- El formato de fotograma (v1), el cifrado, la fuente LT, base45, la bolsa `.szb` y el GIF son
  idénticos a 0.0.1a. Los fotogramas generados por una versión son legibles por la otra.

### Pendiente
- Cabecera compacta (formato v2): ahorro de 38 a 22 bytes por fotograma, requiere compatibilidad.
- Recodificación a WebP antes de cifrar.
- Verificación en un móvil real con cámara.

## 0.0.1a
- Primera versión: cifrado AES-256-GCM, código fuente LT sistemático, base45, GIF propio,
  bolsas `.szb`, Pokédex en `localStorage`.
