// Lectura de VARIOS QR en una misma imagen con jsQR.
//
// Problema: jsQR busca los tres patrones de localización «mejores» de toda la imagen; con
// dos o más QR presentes mezcla patrones de códigos distintos y no lee NINGUNO (medido:
// 0 de 2 y 0 de 4 en mosaicos limpios). Tapar el primero y repetir no sirve si el primero
// no sale.
//
// Solución: dividir la imagen en celdas solapadas según una cuadrícula (2×1, 1×2, 2×2) y
// decodificar cada celda por separado, donde solo hay un código. La cuadrícula que funciona
// se devuelve como `grid` para que el llamador la pida primero en el siguiente fotograma.
//
// Script clásico (no módulo): importScripts en el worker, <script> en el hilo principal y
// vm en los tests. Expone self.shumzuMulti.
(function (root) {
  // Cada celda se amplía un 4 % por lado. El hueco entre códigos del mosaico (2×4 módulos)
  // es ~6 % de una celda: con más solape entran patrones del vecino y jsQR falla (medido con
  // cámara simulada: 12 % → casi ninguna celda legible; 4 % → casi todas).
  var OVERLAP = 0.04;

  function crop(rgba, w, x0, y0, cw, ch) {
    var out = new Uint8ClampedArray(cw * ch * 4);
    for (var y = 0; y < ch; y++) {
      var src = ((y0 + y) * w + x0) * 4;
      out.set(rgba.subarray(src, src + cw * 4), y * cw * 4);
    }
    return out;
  }

  function boxOf(loc, dx, dy) {
    var xs = [loc.topLeftCorner.x, loc.topRightCorner.x, loc.bottomLeftCorner.x, loc.bottomRightCorner.x];
    var ys = [loc.topLeftCorner.y, loc.topRightCorner.y, loc.bottomLeftCorner.y, loc.bottomRightCorner.y];
    var minX = Math.min.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    return { x: dx + minX, y: dy + minY, w: Math.max.apply(null, xs) - minX, h: Math.max.apply(null, ys) - minY };
  }

  function one(jsQR, rgba, w, h, inv) {
    var c = jsQR(rgba, w, h, { inversionAttempts: inv });
    return c && c.data ? c : null;
  }

  // Localiza la pantalla del emisor: la caja de filas y columnas con bastante luz.
  // En cámara el mosaico no llena el encuadre; dividir el fotograma entero corta códigos
  // por la mitad (medido: 0 de 4 leídos). Se muestrea 1 de cada 16 píxeles.
  function brightBox(rgba, w, h) {
    var step = 4;
    var cols = Math.ceil(w / step);
    var rowsN = Math.ceil(h / step);
    var rowHits = new Uint16Array(rowsN);
    var colHits = new Uint16Array(cols);
    for (var y = 0, ry = 0; y < h; y += step, ry++) {
      for (var x = 0, cx = 0; x < w; x += step, cx++) {
        var p = (y * w + x) * 4;
        if (rgba[p] * 0.3 + rgba[p + 1] * 0.59 + rgba[p + 2] * 0.11 > 150) {
          rowHits[ry]++;
          colHits[cx]++;
        }
      }
    }
    function span(hits, total) {
      var a = -1;
      var b = -1;
      for (var i = 0; i < hits.length; i++) {
        if (hits[i] > total * 0.2) {
          if (a < 0) a = i;
          b = i;
        }
      }
      return [a, b];
    }
    var sy = span(rowHits, cols);
    var sx = span(colHits, rowsN);
    if (sy[0] < 0 || sx[0] < 0) return null;
    var box = { x: sx[0] * step, y: sy[0] * step, w: (sx[1] - sx[0] + 1) * step, h: (sy[1] - sy[0] + 1) * step };
    box.w = Math.min(box.w, w - box.x);
    box.h = Math.min(box.h, h - box.y);
    // Si la zona clara es casi toda la imagen (GIF, captura), no aporta nada.
    if (box.w * box.h > w * h * 0.92 || box.w < 42 || box.h < 42) return null;
    return box;
  }

  // Decodifica cada celda de una cuadrícula cols×rows dentro de `reg`. Añade a `acc` lo nuevo.
  function gridPass(jsQR, rgba, w, h, cols, rows, inv, acc, reg) {
    reg = reg || { x: 0, y: 0, w: w, h: h };
    var cw = reg.w / cols;
    var ch = reg.h / rows;
    var found = 0;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var x0 = Math.max(0, Math.floor(reg.x + c * cw - cw * OVERLAP));
        var y0 = Math.max(0, Math.floor(reg.y + r * ch - ch * OVERLAP));
        var x1 = Math.min(w, Math.ceil(reg.x + (c + 1) * cw + cw * OVERLAP));
        var y1 = Math.min(h, Math.ceil(reg.y + (r + 1) * ch + ch * OVERLAP));
        var tw = x1 - x0;
        var th = y1 - y0;
        if (tw < 21 || th < 21) continue;
        var code = one(jsQR, crop(rgba, w, x0, y0, tw, th), tw, th, inv);
        if (code && !acc.seen[code.data]) {
          acc.seen[code.data] = true;
          acc.texts.push(code.data);
          acc.boxes.push(boxOf(code.location, x0, y0));
          found++;
        }
      }
    }
    return found;
  }

  // Cuadrículas a probar según la forma de la imagen (la del emisor: 1×2 vertical, 2×2).
  function plansFor(w, h) {
    var a = w / h;
    if (a > 1.45) return [[2, 1], [2, 2]];
    if (a < 0.69) return [[1, 2], [2, 2]];
    return [[2, 2], [1, 2], [2, 1]];
  }

  // Devuelve { texts, boxes, grid }. `hint` = [cols, rows] de la cuadrícula que funcionó antes.
  root.shumzuMulti = function (jsQR, rgba, w, h, max, inv, hint) {
    inv = inv || 'dontInvert';
    var acc = { texts: [], boxes: [], seen: {} };
    var screen = max > 1 ? brightBox(rgba, w, h) : null;
    // `screen` se devuelve aunque no se lea nada: el escáner lo usa para recortar esa zona a
    // resolución nativa en el siguiente análisis.
    var done = function (grid) { return { texts: acc.texts, boxes: acc.boxes, grid: grid, screen: screen }; };
    // Regiones donde aplicar la cuadrícula: primero la pantalla localizada, luego la imagen.
    var regions = screen ? [screen, null] : [null];
    if (max > 1 && hint && hint[0] * hint[1] > 1) {
      for (var k = 0; k < regions.length; k++) {
        if (gridPass(jsQR, rgba, w, h, hint[0], hint[1], inv, acc, regions[k]) > 0) return done(hint);
      }
    }
    var c = one(jsQR, rgba, w, h, inv);
    if (c) {
      acc.texts.push(c.data);
      acc.boxes.push(boxOf(c.location, 0, 0));
      acc.seen[c.data] = true;
    }
    if (max <= 1 || c) return done(null);
    for (var j = 0; j < regions.length; j++) {
      var reg = regions[j] || { x: 0, y: 0, w: w, h: h };
      var plans = plansFor(reg.w, reg.h);
      for (var i = 0; i < plans.length; i++) {
        if (gridPass(jsQR, rgba, w, h, plans[i][0], plans[i][1], inv, acc, regions[j]) > 0) return done(plans[i]);
      }
    }
    return done(null);
  };
})(typeof self !== 'undefined' ? self : globalThis);
