# Auditoría de SHUMZU 0.0.1a

Fecha: 2026-10-16. Alcance: todo el código de `SHUMZU-v0.0.1a` (núcleo, interfaz, escáner, documentación).
Cada hallazgo indica cómo se comprobó y su estado en 0.2.0.

Leyenda de comprobación: **medido** (reproducido con código o en Chromium), **leído** (revisión de código).

## Fallos

| # | Hallazgo | Comprobación | Impacto | Estado en 0.2.0 |
|--:|---|---|---|---|
| 1 | **No se podía guardar un envío de más de ~3,3 MB**, aunque el límite anunciado era 8 MB. La persistencia escribía todos los fotogramas como base64 en una sola clave de `localStorage`; Chromium admite ~5,24 M caracteres y un envío de 8 MB necesita 13,4 M. El error solo mostraba un aviso. | medido | Pérdida de capturas al recargar | IndexedDB por fotograma, migración automática (0.1.0 y 0.2.0) |
| 2 | La persistencia **reescribía todo el lote tras cada fotograma** (base64 completo cada 300 ms): coste cuadrático durante el escaneo. | leído | Tirones en la cámara con envíos grandes | Escritura por fotograma, en lotes de 120 ms |
| 3 | **Un solo fotograma manipulado bloqueaba un envío entero.** El almacén y el receptor fijaban K/S/L con el primer fotograma de cada sesión; uno con la misma sesión y otra L (CRC válido) hacía que todos los legítimos se rechazaran. Un relevo por bolsas podía anular cualquier envío. | medido (test «variantes») | Denegación de servicio por relevo | Cada combinación sesión+K+S+L es una variante independiente; la manipulada aparece aparte, marcada con ≠ |
| 4 | **Una imagen con dos o más QR no daba ninguno.** jsQR mezcla patrones de localización de códigos distintos y falla (0 de 2, 0 de 4). | medido | Capturas de pantalla con varios códigos inútiles | Lectura por celdas con localización de la pantalla (multiqr.js) |
| 5 | `FrameStore.allFrames()` usaba `push(...spread)`: **RangeError a partir de ~130 000 fotogramas.** | medido | Exportar la bolsa de relevo fallaba con muchos envíos; con 32 MB habría sido seguro | Bucle sin spread; test con 150 000 |
| 6 | El README decía que S=200 genera un **QR v9**; en realidad son 357 caracteres → **v10**. S=300 es v12, no v11. | medido | Documentación incorrecta; el 10 % del QR quedaba sin usar | Tamaños que llenan su versión: S=225 en el mismo v10 (+12,5 % de datos por QR) |
| 7 | GIF y bolsas exportaban `⌈1,5·K⌉+8` fotogramas, el margen pensado para cámara, aunque un GIF o una bolsa no pierden fotogramas. | medido | GIF y bolsas ~18 % más grandes de lo necesario (310 frente a 254 con K=201) | `leanCount` = K + 25 % + 2; probado con un 8 % de fotogramas estropeados |
| 8 | Un envío grande generaba el GIF sin límite: 8 MB a S=200 son ~63 000 fotogramas codificados en el hilo principal. | leído (cálculo) | Pestaña bloqueada | El GIF se desactiva por encima de 3000 fotogramas y se propone la bolsa |
| 9 | La etiqueta de conexión estaba **invertida**: con red mostraba «offline · local». | leído | Confusión | Corregido (0.1.0) |
| 10 | El escáner decodificaba en el **hilo principal** (jsQR a 640 px, `setTimeout` 60 ms + rAF) y seguía activo con la pestaña oculta. | leído | Interfaz bloqueada, batería | Pool de workers, `requestVideoFrameCallback`, pausa en segundo plano |
| 11 | El carrusel (`setInterval`) seguía al cambiar de vista o con la pestaña oculta, y recodificaba cada QR desde cero en cada tic. | leído | CPU y batería | Se pausa fuera de la vista; caché de matrices; precálculo en tiempo ocioso |
| 12 | Cada fotograma se decodificaba (CRC incluido) **tres veces**: almacén, id de sesión y receptor. | leído | CPU desperdiciada | Una sola decodificación (`addParsed` + `addFrame`) |
| 13 | Cada lectura recalculaba `store.allFrames()` (array completo) solo para mostrar un número; la Pokédex reconstruía todas las tarjetas. | leído | Coste lineal por fotograma | Contador `total`; filas reutilizadas por clave |
| 14 | El tamaño declarado del archivo (`s`) no se comprobaba al ensamblar. | leído | Menor (el SHA-256 ya protege) | Se comprueba |
| 15 | HTML inválido: `<button>` dentro de `<a>` en «Guardar». | leído | Accesibilidad | Botón con descarga programática |
| 16 | El mensaje de error del límite decía «v0.1.0» en la versión 0.0.1a. | leído | Cosmético | Mensaje con el límite real |
| 17 | Sin `wakeLock`: la pantalla del emisor podía apagarse a mitad de un envío largo. | leído | Envíos interrumpidos | Wake lock al emitir y al escanear |

## Riesgos de diseño que requieren formato v2 (no corregidos)

- **Cabecera sin autenticar.** Banderas, K, S y L viajan fuera del cifrado y solo los protege el CRC. Con la corrección 3 ya no pueden bloquear un envío, pero solo AES-GCM con datos asociados (AAD) los autenticaría.
- **Parámetros de derivación fijos.** PBKDF2-SHA256 con 310 000 iteraciones va fijo en el código, no en la cabecera; subirlo (OWASP recomienda 600 000 desde 2023) rompería la compatibilidad. Un formato v2 debería incluir el algoritmo y el coste.
- **Cabecera de 38 bytes por fotograma** (sesión de 16 bytes repetida en cada QR). Una cabecera compacta ahorraría ~16 bytes por QR (~7 % con S=225).

## Comprobaciones que salieron bien

- base45 (RFC 9285) es correcto y es la codificación adecuada para el modo alfanumérico de QR.
- La fuente LT sistemática funciona: sin pérdidas basta con K fotogramas.
- El cifrado (AES-256-GCM, una clave por sesión, IV fijo seguro porque cada clave cifra un solo mensaje) es correcto.
- La vista previa no renderiza SVG ni HTML, y el texto se inserta con `textContent`.
- `textToFrame` recorta espacios aunque el espacio pertenece a base45; es seguro porque un fotograma siempre empieza por «8» (la magia «SZ») y su último carácter nunca es un espacio. Queda documentado en el código.
