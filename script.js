class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.inactiveOverlay = document.getElementById('inactiveOverlay');
        this.progressText = document.getElementById('progressText');
        this.progressBar = document.getElementById('progressBar');
        this.stream = null;
        this.scanning = false;
        this.qrDataMap = new Map();
        this.password = null;
        this.totalBlocks = null; // Estimado tras leer metadatos
        this.init();
    }

    init() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            alert('Este navegador no soporta el acceso a la cámara.');
            return;
        }

        this.cameraContainer.addEventListener('click', () => this.toggleCamera());
        document.getElementById('reconstructButton').addEventListener('click', () => this.reconstructFile());
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    async toggleCamera() {
        if (this.stream) {
            this.stopCamera();
        } else {
            await this.startCamera();
        }
    }

    async startCamera() {
        try {
            this.cameraContainer.classList.add('active');
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { 
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                } 
            });
            this.video.srcObject = this.stream;
            
            await new Promise((resolve) => {
                this.video.onloadedmetadata = () => {
                    this.video.play().then(resolve);
                };
            });
            
            this.scanning = true;
            this.scan();
        } catch (err) {
            console.error('Error al acceder a la cámara:', err);
            this.cameraContainer.classList.remove('active');
            alert('No se pudo acceder a la cámara: ' + err.message);
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.scanning = false;
        this.video.srcObject = null;
        this.cameraContainer.classList.remove('active');
        this.updateProgress(0, null);
    }

    scan() {
        if (!this.scanning) return;

        if (this.video.videoWidth === 0 || this.video.videoHeight === 0) {
            requestAnimationFrame(() => this.scan());
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        
        context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        
        // Detectar múltiples QR usando jsQR (limitado a uno por frame por defecto)
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert'
        });

        if (code) {
            this.handleQRCode(code.data);
        }

        // Escaneo adicional para múltiples QR dividiendo la imagen en regiones
        this.scanMultipleRegions(imageData, canvas.width, canvas.height);

        setTimeout(() => this.scan(), 100); // 10 FPS para reducir carga
    }

    scanMultipleRegions(imageData, width, height) {
        const regions = [
            { x: 0, y: 0, w: width / 2, h: height / 2 }, // Top-left
            { x: width / 2, y: 0, w: width / 2, h: height / 2 }, // Top-right
            { x: 0, y: height / 2, w: width / 2, h: height / 2 }, // Bottom-left
            { x: width / 2, y: height / 2, w: width / 2, h: height / 2 } // Bottom-right
        ];

        regions.forEach(region => {
            const regionData = this.extractRegion(imageData, region.x, region.y, region.w, region.h);
            const code = jsQR(regionData.data, region.w, region.h);
            if (code) {
                this.handleQRCode(code.data);
            }
        });
    }

    extractRegion(imageData, x, y, w, h) {
        const newData = new Uint8ClampedArray(w * h * 4);
        for (let i = 0; i < h; i++) {
            for (let j = 0; j < w; j++) {
                const srcIndex = ((y + i) * imageData.width + (x + j)) * 4;
                const destIndex = (i * w + j) * 4;
                newData[destIndex] = imageData.data[srcIndex];
                newData[destIndex + 1] = imageData.data[srcIndex + 1];
                newData[destIndex + 2] = imageData.data[srcIndex + 2];
                newData[destIndex + 3] = imageData.data[srcIndex + 3];
            }
        }
        return new ImageData(newData, w, h);
    }

    handleQRCode(data) {
        try {
            const qrData = JSON.parse(data);
            if (typeof qrData.index !== 'number' || typeof qrData.data !== 'string') {
                throw new Error('Formato de datos QR inválido');
            }
            if (!this.qrDataMap.has(qrData.index)) {
                this.qrDataMap.set(qrData.index, qrData.data);
                this.updateProgress(this.qrDataMap.size, this.totalBlocks);
                console.log(`QR detectado: índice ${qrData.index}, total: ${this.qrDataMap.size}`);
            }
            
            if (qrData.index === 0 && this.qrDataMap.size === 1) {
                this.promptPassword();
            }
        } catch (error) {
            console.error('Error al analizar datos QR:', error);
        }
    }

    promptPassword() {
        const password = prompt('Ingrese la contraseña para descifrar los datos (deje en blanco si no hay encriptación):');
        this.password = password || null;
    }

    updateProgress(detected, total) {
        this.progressText.textContent = total 
            ? `Escaneando QR: ${detected} de ${total} detectados` 
            : `Escaneando QR: ${detected} detectados`;
        const percentage = total ? (detected / total) * 100 : 0;
        this.progressBar.style.width = `${percentage}%`;
    }

    async deriveKey(password, salt) {
        const hash = await argon2.hash({
            pass: password,
            salt: salt,
            time: 2,
            mem: 102400,
            parallelism: 8,
            hashLen: 32,
            type: argon2.ArgonType.Argon2id
        });
        return new Uint8Array(hash.hash);
    }

    async decryptData(encryptedData, password) {
        const bytes = new Uint8Array([...window.atob(encryptedData)].map(c => c.charCodeAt(0)));
        const salt = bytes.slice(0, 16);
        const nonce = bytes.slice(16, 28);
        const tag = bytes.slice(28, 44);
        const ciphertext = bytes.slice(44);
        const dataToDecrypt = new Uint8Array([...ciphertext, ...tag]);
        
        const keyMaterial = await this.deriveKey(password, salt);
        const key = await crypto.subtle.importKey(
            "raw",
            keyMaterial,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );
        
        const decrypted = await crypto.subtle.decrypt(
            {
                name: "AES-GCM",
                iv: nonce,
                tagLength: 128
            },
            key,
            dataToDecrypt
        );
        return new Uint8Array(decrypted);
    }

    decompressData(compressedData) {
        try {
            const zstdDecompressed = ZSTD.decompress(compressedData);
            const brotliDecompressed = brotliDecompress(zstdDecompressed);
            return brotliDecompressed;
        } catch (error) {
            throw new Error('Error al descomprimir los datos: ' + error.message);
        }
    }

    async reconstructFile() {
        if (this.qrDataMap.size === 0) {
            alert('No se han escaneado QR codes.');
            return;
        }

        try {
            const encryptedMetadata = this.qrDataMap.get(0);
            if (!encryptedMetadata) {
                throw new Error('Metadato faltante (índice 0).');
            }

            let compressedMetadata;
            if (this.password) {
                if (!this.password && this.qrDataMap.size === 1) {
                    this.promptPassword();
                    if (!this.password) return;
                }
                compressedMetadata = await this.decryptData(encryptedMetadata, this.password);
            } else {
                compressedMetadata = new Uint8Array([...window.atob(encryptedMetadata)].map(c => c.charCodeAt(0)));
            }

            const metadataStr = new TextDecoder().decode(this.decompressData(compressedMetadata));
            const metadata = JSON.parse(metadataStr);
            const fileName = metadata.file_name;
            const expectedHash = metadata.hash;
            this.totalBlocks = this.qrDataMap.size; // Actualizar total estimado
            this.updateProgress(this.qrDataMap.size, this.totalBlocks);

            const maxIndex = Math.max(...this.qrDataMap.keys());
            let reconstructedData = new Uint8Array();

            for (let i = 1; i <= maxIndex; i++) {
                const encryptedBlock = this.qrDataMap.get(i);
                if (!encryptedBlock) {
                    throw new Error(`Falta el bloque ${i}.`);
                }
                let blockData;
                if (this.password) {
                    const compressedBlock = await this.decryptData(encryptedBlock, this.password);
                    blockData = this.decompressData(compressedBlock);
                } else {
                    const compressedBlock = new Uint8Array([...window.atob(encryptedBlock)].map(c => c.charCodeAt(0)));
                    blockData = this.decompressData(compressedBlock);
                }
                reconstructedData = new Uint8Array([...reconstructedData, ...blockData]);
            }

            const computedHash = sha3_256(reconstructedData);
            if (computedHash !== expectedHash) {
                throw new Error('Verificación de integridad fallida: hashes no coinciden.');
            }

            this.downloadFile(reconstructedData, fileName);
            alert('Archivo reconstruido exitosamente.');
            this.cleanup();
        } catch (error) {
            console.error('Error al reconstruir el archivo:', error);
            alert('Error al reconstruir el archivo: ' + error.message);
        }
    }

    downloadFile(data, filename) {
        const blob = new Blob([data], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    cleanup() {
        this.stopCamera();
        this.qrDataMap.clear();
        this.password = null;
        this.totalBlocks = null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scanner = new QRScanner();
});
