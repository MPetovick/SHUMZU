// shumzu-compat.js - Versión optimizada y corregida
class SHUMZUCompat {
    constructor() {
        this.reset();
    }
    
    reset() {
        this.qrData = new Map();
        this.metadata = null;
        this.blockSize = 1024;
        this.totalBlocks = 0;
        this.isEncrypted = false;
        this.isCompressed = false;
        this.salt = null;
        this.receivedMetadata = false;
    }
    
    decodePythonQR(jsonData) {
        try {
            const data = typeof jsonData === 'string' ? 
                JSON.parse(jsonData) : jsonData;
            
            if (!data || typeof data !== 'object') {
                return null;
            }
            
            if (data.i === 0 && data.m) {
                // Bloque de metadatos
                this.processMetadata(data.m);
                
                if (data.d) {
                    this.processBlock(1, data.d);
                }
                
                return {
                    type: 'metadata',
                    metadata: this.metadata,
                    hasFirstBlock: !!data.d
                };
            } 
            else if (data.i > 0 && data.d) {
                // Bloque de datos
                const isNew = this.processBlock(data.i, data.d);
                return {
                    type: 'data',
                    index: data.i,
                    isNew: isNew,
                    totalBlocks: this.totalBlocks
                };
            }
            
            return null;
        } catch (error) {
            console.warn('Error decodificando QR:', error);
            return null;
        }
    }
    
    processMetadata(metadata) {
        if (this.receivedMetadata) {
            return; // Ya tenemos metadatos
        }
        
        this.metadata = metadata;
        this.totalBlocks = metadata.tb || 0;
        this.isEncrypted = metadata.e === 1;
        this.isCompressed = metadata.c === 1;
        this.blockSize = metadata.bs || 1024;
        
        if (metadata.salt) {
            this.salt = this.base64ToBytes(metadata.salt);
        }
        
        this.receivedMetadata = true;
    }
    
    processBlock(index, base64Data) {
        if (!this.qrData.has(index)) {
            this.qrData.set(index, base64Data);
            return true;
        }
        return false;
    }
    
    async reconstructFile(password = '') {
        if (!this.metadata || this.totalBlocks === 0) {
            throw new Error('Metadatos incompletos para reconstrucción');
        }
        
        const startTime = Date.now();
        const expectedSize = this.metadata.s;
        const resultData = new Uint8Array(expectedSize);
        let receivedBlocks = 0;
        let errors = 0;
        
        // Reconstruir en orden
        for (let i = 1; i <= this.totalBlocks - 1; i++) {
            if (this.qrData.has(i)) {
                try {
                    const blockData = this.base64ToBytes(this.qrData.get(i));
                    
                    // Descifrar si es necesario
                    let decryptedData = blockData;
                    if (this.isEncrypted) {
                        decryptedData = await this.decryptBlock(blockData, password);
                    }
                    
                    // Colocar en posición
                    const start = (i - 1) * this.blockSize;
                    const end = Math.min(start + decryptedData.length, expectedSize);
                    const length = end - start;
                    
                    if (length > 0) {
                        resultData.set(decryptedData.subarray(0, length), start);
                        receivedBlocks++;
                    }
                } catch (error) {
                    console.warn(`Error procesando bloque ${i}:`, error.message);
                    errors++;
                }
            }
        }
        
        // Verificar que tenemos suficientes bloques
        if (receivedBlocks < Math.floor((this.totalBlocks - 1) * 0.5)) {
            throw new Error(`Bloques insuficientes: ${receivedBlocks}/${this.totalBlocks - 1}`);
        }
        
        // Descomprimir si es necesario
        let finalData = resultData;
        if (this.isCompressed && receivedBlocks > 0) {
            try {
                finalData = pako.inflate(resultData);
            } catch (error) {
                console.warn('Error descomprimiendo, usando datos sin comprimir:', error);
            }
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
            totalBlocks: this.totalBlocks - 1,
            errors,
            reconstructionTime: Date.now() - startTime,
            status: hashMatches ? 'success' : 'warning',
            message: hashMatches ? 
                'Archivo reconstruido exitosamente' : 
                'Archivo reconstruido pero hash no coincide'
        };
    }
    
    async decryptBlock(encryptedData, password) {
        if (!password) {
            throw new Error('Se requiere contraseña para descifrar');
        }
        
        try {
            // Extraer salt e IV (asumiendo formato: salt(16) + iv(12) + ciphertext)
            const salt = encryptedData.slice(0, 16);
            const iv = encryptedData.slice(16, 28);
            const ciphertext = encryptedData.slice(28);
            
            // Derivar clave usando PBKDF2 (compatible con shumzuX.py)
            const encoder = new TextEncoder();
            const passwordBuffer = encoder.encode(password);
            
            const baseKey = await crypto.subtle.importKey(
                'raw',
                passwordBuffer,
                'PBKDF2',
                false,
                ['deriveKey']
            );
            
            const key = await crypto.subtle.deriveKey(
                {
                    name: 'PBKDF2',
                    salt: salt,
                    iterations: 100000,
                    hash: 'SHA-256'
                },
                baseKey,
                { name: 'AES-GCM', length: 256 },
                false,
                ['decrypt']
            );
            
            // Descifrar
            const decrypted = await crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                key,
                ciphertext
            );
            
            return new Uint8Array(decrypted);
            
        } catch (error) {
            if (error.message.includes('decryption')) {
                throw new Error('Contraseña incorrecta o datos corruptos');
            }
            throw new Error(`Error en descifrado: ${error.message}`);
        }
    }
    
    async calculateSHA256(data) {
        try {
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            return Array.from(new Uint8Array(hashBuffer))
                .map(b => b.toString(16).padStart(2, '0'))
                .join('');
        } catch (error) {
            console.error('Error calculando SHA256:', error);
            return '';
        }
    }
    
    base64ToBytes(base64) {
        try {
            const binaryString = atob(base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            return bytes;
        } catch (error) {
            throw new Error(`Base64 inválido: ${error.message}`);
        }
    }
    
    getProgress() {
        if (!this.totalBlocks || this.totalBlocks <= 1) return 0;
        const dataBlocks = this.totalBlocks - 1;
        const received = Array.from(this.qrData.keys())
            .filter(i => i > 0 && i <= dataBlocks).length;
        return Math.min(100, Math.round((received / dataBlocks) * 100));
    }
    
    getMissingBlocks() {
        if (!this.totalBlocks) return [];
        const missing = [];
        for (let i = 1; i <= this.totalBlocks - 1; i++) {
            if (!this.qrData.has(i)) {
                missing.push(i);
            }
        }
        return missing;
    }
    
    getStatistics() {
        const totalDataBlocks = this.totalBlocks > 0 ? this.totalBlocks - 1 : 0;
        const received = Array.from(this.qrData.keys())
            .filter(i => i > 0 && i <= totalDataBlocks).length;
        
        return {
            metadata: this.receivedMetadata,
            totalBlocks: totalDataBlocks,
            receivedBlocks: received,
            missingBlocks: totalDataBlocks - received,
            progress: this.getProgress(),
            isEncrypted: this.isEncrypted,
            isCompressed: this.isCompressed,
            blockSize: this.blockSize
        };
    }
}

// Función de detección optimizada
function detectSHUMZUFormat(qrData) {
    if (!qrData || typeof qrData !== 'string') {
        return 'invalid';
    }
    
    // Intentar parsear como JSON
    try {
        const data = JSON.parse(qrData);
        
        // Formato Python (shumzuX.py)
        if (data.i !== undefined && (data.m || data.d)) {
            return 'python';
        }
        
        // Formato Web
        if (data.v && data.v.startsWith('SHZ')) {
            return 'web';
        }
        
        return 'unknown';
    } catch {
        // No es JSON, verificar otros formatos
        if (qrData.includes('SHUMZU') || qrData.includes('SHZ')) {
            return 'text';
        }
        
        return 'invalid';
    }
}

// Función de detección múltiple (simplificada)
function detectMultipleQRs(imageData, width, height) {
    const qrCodes = [];
    
    // Usar jsQR en diferentes regiones para mejor detección
    const code = jsQR(imageData.data, width, height, {
        inversionAttempts: 'attemptBoth',
    });
    
    if (code) {
        qrCodes.push(code);
    }
    
    return qrCodes;
}

// Exportar para uso global
if (typeof window !== 'undefined') {
    window.SHUMZUCompat = SHUMZUCompat;
    window.detectSHUMZUFormat = detectSHUMZUFormat;
    window.detectMultipleQRs = detectMultipleQRs;
}
