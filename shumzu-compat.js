// shumzu-compat.js - Compatibilidad completa con shumzuX.py
const SHUMZU_COMPAT_VERSION = 'SHZ-PYv1';

// Configuración compatible con Python
const COMPAT_CONFIG = {
    AES_BLOCK_SIZE: 16,
    KEY_ITERATIONS: 100000,
    MAX_QR_CAPACITY: 2953,
    SAFE_CAPACITY: 2900,
    FRAME_SIZE: { width: 400, height: 400 }
};

class SHUMZUCompat {
    constructor() {
        this.qrData = new Map();
        this.metadata = null;
        this.blockSize = 0;
        this.totalBlocks = 0;
        this.isEncrypted = false;
        this.isCompressed = false;
        this.salt = null;
    }
    
    // Decodificar QR de Python
    decodePythonQR(jsonData) {
        try {
            const data = typeof jsonData === 'string' ? JSON.parse(jsonData) : jsonData;
            
            if (data.i === 0) {
                // Bloque de metadatos
                if (data.m) {
                    this.metadata = data.m;
                    this.totalBlocks = this.metadata.b || 0;
                    this.isEncrypted = this.metadata.e === 1;
                    this.isCompressed = this.metadata.c === 1;
                    this.blockSize = this.metadata.bs || 1024;
                    
                    if (this.metadata.salt) {
                        this.salt = this.base64ToBytes(this.metadata.salt);
                    }
                    
                    // Si incluye primer bloque de datos
                    if (data.d) {
                        this.processBlock(1, data.d);
                    }
                    
                    return {
                        type: 'metadata',
                        metadata: this.metadata,
                        hasFirstBlock: !!data.d
                    };
                }
            } else if (data.i > 0 && data.d) {
                // Bloque de datos normal
                this.processBlock(data.i, data.d);
                return {
                    type: 'data',
                    index: data.i,
                    hasData: true
                };
            }
            
            return null;
        } catch (error) {
            console.error('Error decodificando QR Python:', error);
            return null;
        }
    }
    
    processBlock(index, base64Data) {
        if (!this.qrData.has(index)) {
            this.qrData.set(index, base64Data);
            return true;
        }
        return false;
    }
    
    // Reconstruir archivo compatible con Python
    async reconstructFile(password = '') {
        if (!this.metadata || this.totalBlocks === 0) {
            throw new Error('No hay metadatos suficientes');
        }
        
        const startTime = Date.now();
        const allData = new Uint8Array(this.metadata.s);
        let receivedBlocks = 0;
        
        // Reconstruir en orden
        for (let i = 1; i <= this.totalBlocks; i++) {
            if (this.qrData.has(i)) {
                let blockData = this.base64ToBytes(this.qrData.get(i));
                
                // Descifrar si es necesario
                if (this.isEncrypted && password) {
                    blockData = await this.decryptPython(blockData, password);
                }
                
                // Colocar en posición
                const start = (i - 1) * this.blockSize;
                const end = Math.min(start + blockData.length, allData.length);
                allData.set(blockData.subarray(0, end - start), start);
                receivedBlocks++;
            }
        }
        
        // Descomprimir si es necesario
        let finalData = allData;
        if (this.isCompressed) {
            finalData = this.decompressPython(finalData);
        }
        
        // Verificar hash
        const hash = await this.calculateSHA256(finalData);
        const hashMatches = hash === this.metadata.h;
        
        return {
            data: finalData,
            metadata: this.metadata,
            hashMatches,
            computedHash: hash,
            receivedBlocks,
            totalBlocks: this.totalBlocks,
            reconstructionTime: Date.now() - startTime
        };
    }
    
    // Descifrar compatible con Python (AES-256-CBC)
    async decryptPython(encryptedData, password) {
        if (!password) {
            throw new Error('Se requiere contraseña para descifrar');
        }
        
        try {
            // Extraer salt e IV (compatible con Python)
            const salt = encryptedData.slice(0, 16);
            const iv = encryptedData.slice(16, 32);
            const ciphertext = encryptedData.slice(32);
            
            // Derivar clave PBKDF2 (compatible con Python)
            const key = await this.deriveKeyPBKDF2(password, salt);
            
            // Descifrar AES-CBC
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: 'AES-CBC',
                    iv: iv
                },
                key,
                ciphertext
            );
            
            // Quitar padding PKCS7
            return this.unpadPKCS7(new Uint8Array(decrypted));
        } catch (error) {
            throw new Error(`Error descifrando: ${error.message}`);
        }
    }
    
    async deriveKeyPBKDF2(password, salt) {
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        
        const baseKey = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            'PBKDF2',
            false,
            ['deriveKey']
        );
        
        return crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: COMPAT_CONFIG.KEY_ITERATIONS,
                hash: 'SHA-256'
            },
            baseKey,
            { name: 'AES-CBC', length: 256 },
            false,
            ['decrypt']
        );
    }
    
    unpadPKCS7(data) {
        const padLength = data[data.length - 1];
        if (padLength > COMPAT_CONFIG.AES_BLOCK_SIZE) {
            return data;
        }
        return data.slice(0, data.length - padLength);
    }
    
    // Descomprimir compatible con Python (zlib)
    decompressPython(data) {
        try {
            // pako soporta formato zlib
            return pako.inflate(data);
        } catch (error) {
            console.warn('Error descomprimiendo, devolviendo datos originales:', error);
            return data;
        }
    }
    
    // Calcular SHA-256 (compatible con Python)
    async calculateSHA256(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    // Utilidades
    base64ToBytes(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    
    bytesToBase64(bytes) {
        const binary = String.fromCharCode.apply(null, bytes);
        return btoa(binary);
    }
    
    formatFileSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
    
    getProgress() {
        if (!this.totalBlocks) return 0;
        return Math.round((this.qrData.size / this.totalBlocks) * 100);
    }
    
    reset() {
        this.qrData.clear();
        this.metadata = null;
        this.totalBlocks = 0;
        this.blockSize = 0;
        this.isEncrypted = false;
        this.isCompressed = false;
        this.salt = null;
    }
}

// Detectar formato automáticamente
function detectSHUMZUFormat(qrData) {
    try {
        const data = typeof qrData === 'string' ? JSON.parse(qrData) : qrData;
        
        // Formato Python (shumzuX.py)
        if (data.i !== undefined && (data.m || data.d)) {
            return 'python';
        }
        
        // Formato Web (SHZv4)
        if (data.v && data.v.startsWith('SHZ')) {
            return 'web';
        }
        
        return 'unknown';
    } catch {
        return 'invalid';
    }
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.SHUMZUCompat = SHUMZUCompat;
    window.detectSHUMZUFormat = detectSHUMZUFormat;
    window.COMPAT_CONFIG = COMPAT_CONFIG;
}
