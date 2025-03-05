class QRScanner {
    constructor() {
        this.video = document.getElementById('video');
        this.cameraContainer = document.getElementById('cameraContainer');
        this.inactiveOverlay = document.getElementById('inactiveOverlay');
        this.stream = null;
        this.scanning = false;
        this.qrDataMap = new Map();
        this.password = null;
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
            this.cameraContainer.classList.add('active'); // Add 'active' before starting camera
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
            this.cameraContainer.classList.remove('active'); // Remove 'active' on error
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
        this.cameraContainer.classList.remove('active'); // Remove 'active' to show overlay
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
        
        try {
            context.drawImage(this.video, 0, 0, canvas.width, canvas.height);
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);

            if (code) {
                this.handleQRCode(code.data);
            }
        } catch (error) {
            console.error('Error en el escaneo:', error);
        }

        requestAnimationFrame(() => this.scan());
    }

    handleQRCode(data) {
        try {
            const qrData = JSON.parse(data);
            if (typeof qrData.index !== 'number' || typeof qrData.data !== 'string') {
                throw new Error('Formato de datos QR inválido');
            }
            this.qrDataMap.set(qrData.index, qrData.data);
            console.log(`QR Code detectado: índice ${qrData.index}`);
            
            if (this.qrDataMap.size === 1) {
                this.promptPassword();
            }
        } catch (error) {
            console.error('Error al analizar datos QR:', error);
        }
    }

    promptPassword() {
        const password = prompt('Ingrese la contraseña para descifrar los datos:');
        if (password !== null) {
            this.password = password;
        } else {
            alert('Se requiere una contraseña para continuar.');
            this.stopCamera();
        }
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
        // Placeholder: Implement with real decompression libraries (Zstandard/Brotli)
        return compressedData;
    }

    async reconstructFile() {
        if (this.qrDataMap.size === 0) {
            alert('No se han escaneado QR codes.');
            return;
        }

        if (!this.password) {
            alert('Proporcione la contraseña.');
            return;
        }

        try {
            const encryptedMetadata = this.qrDataMap.get(0);
            if (!encryptedMetadata) {
                throw new Error('Metadato faltante (índice 0).');
            }
            const compressedMetadata = await this.decryptData(encryptedMetadata, this.password);
            const metadataStr = new TextDecoder().decode(this.decompressData(compressedMetadata));
            const metadata = JSON.parse(metadataStr);
            const fileName = metadata.file_name;
            const expectedHash = metadata.hash;

            const maxIndex = Math.max(...this.qrDataMap.keys());
            let reconstructedData = new Uint8Array();

            for (let i = 1; i <= maxIndex; i++) {
                const encryptedBlock = this.qrDataMap.get(i);
                if (!encryptedBlock) {
                    throw new Error(`Falta el bloque ${i}.`);
                }
                const compressedBlock = await this.decryptData(encryptedBlock, this.password);
                const blockData = this.decompressData(compressedBlock);
                reconstructedData = new Uint8Array([...reconstructedData, ...blockData]);
            }

            const computedHash = sha3_256(reconstructedData);
            if (computedHash !== expectedHash) {
                throw new Error('Verificación de integridad fallida: hashes no coinciden.');
            }

            this.downloadFile(reconstructedData, fileName);
            alert('Archivo reconstruido exitosamente.');
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
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const scanner = new QRScanner();
});
