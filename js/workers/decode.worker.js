// Worker de decodificación: jsQR corre fuera del hilo principal, así que la interfaz
// no se congela al escanear ni al importar GIF grandes.
self.window = self; // el bundle UMD de jsQR busca `window` o `self` según el entorno
importScripts('../../vendor/jsQR.js');

self.onmessage = (ev) => {
  const { id, buf, w, h, inv } = ev.data;
  let text = null;
  try {
    const jsQR = self.jsQR || self.window.jsQR;
    const code = jsQR(new Uint8ClampedArray(buf), w, h, { inversionAttempts: inv });
    text = code && code.data ? code.data : null;
  } catch {
    text = null;
  }
  self.postMessage({ id, text });
};
