// Transporte visual: dibujar QR (vía window.QRCode) y escanear con cámara (vía jsQR).

export function renderFrame(canvas, text, width = 360) {
  return window.QRCode.toCanvas(canvas, text, {
    errorCorrectionLevel: 'L',
    margin: 2,
    width,
  });
}

export class Scanner {
  constructor(video, onText) {
    this.video = video;
    this.onText = onText;
    this.stream = null;
    this.running = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no permite usar la cámara');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    this.video.srcObject = this.stream;
    this.video.hidden = false;
    await this.video.play();
    this.running = true;
    this.tick();
  }

  tick = () => {
    if (!this.running) return;
    const v = this.video;
    if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth) {
      const scale = Math.min(1, 640 / v.videoWidth);
      const w = Math.round(v.videoWidth * scale);
      const h = Math.round(v.videoHeight * scale);
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.drawImage(v, 0, 0, w, h);
      const img = this.ctx.getImageData(0, 0, w, h);
      const code = window.jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
      if (code && code.data) this.onText(code.data);
    }
    setTimeout(() => requestAnimationFrame(this.tick), 60);
  };

  stop() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.video.hidden = true;
  }
}
