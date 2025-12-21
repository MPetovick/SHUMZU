// shumzu-compat.js - Versión optimizada
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
                this.metadata = data.m;
                this.totalBlocks = this.metadata.tb || 0;
                this.isEncrypted = this.metadata.e === 1;
                this.isCompressed = this.metadata.c === 1;
                this.blockSize = this.metadata.bs || 1024;
                
                if (this.metadata.salt) {
                    this.salt = this.base64ToBytes(this.metadata.salt);
                }
                
                // Procesar primer bloque si está incluido
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
                this.processBlock(data.i, data.d);
                return {
                    type: 'data',
                    index: data.i,
                    hasData: true
                };
            }
            
            return null;
        } catch (error) {
            console.warn('Error decodificando QR:', error);
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
    
    async reconstructFile(password = '') {
        if (!this.metadata || this.totalBlocks === 0) {
            throw new Error('Metadatos incompletos');
        }
        
        const startTime = Date.now();
        const fileSize = this.metadata.s;
        const resultData = new Uint8Array(fileSize);
        let receivedBlocks = 0;
        
        // Procesar bloques en orden
        for (let i = 1; i <= this.totalBlocks - 1; i++) { // -1 porque el bloque 0 son metadatos
            if (this.qrData.has(i)) {
                try {
                    let blockData = this.base64ToBytes(this.qrData.get(i));
                    
                    // Descifrar si es necesario
                    if (this.isEncrypted) {
                        blockData = await this.decryptBlock(blockData, password);
                    }
                    
                    // Colocar en posición
                    const start = (i - 1) * this.blockSize;
                    const end = Math.min(start + blockData.length, fileSize);
                    const length = end - start;
                    
                    if (length > 0) {
                        resultData.set(blockData.subarray(0, length), start);
                        receivedBlocks++;
                    }
                } catch (error) {
                    console.warn(`Error procesando bloque ${i}:`, error.message);
                }
            }
        }
        
        // Descomprimir si es necesario
        let finalData = resultData;
        if (this.isCompressed && receivedBlocks > 0) {
            try {
                finalData = pako.inflate(resultData);
            } catch (error) {
                console.warn('Error descomprimiendo:', error);
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
            reconstructionTime: Date.now() - startTime
        };
    }
    
    async decryptBlock(encryptedData, password) {
        if (!password) {
            throw new Error('Se requiere contraseña');
        }
        
        try {
            // Extraer salt e IV
            const salt = encryptedData.slice(0, 16);
            const iv = encryptedData.slice(16, 32);
            const ciphertext = encryptedData.slice(32);
            
            // Derivar clave
            const key = await this.deriveKey(password, salt);
            
            // Descifrar
            const decrypted = await crypto.subtle.decrypt(
                { name: 'AES-CBC', iv: iv },
                key,
                ciphertext
            );
            
            return this.unpadPKCS7(new Uint8Array(decrypted));
        } catch (error) {
            throw new Error(`Error descifrando: ${error.message}`);
        }
    }
    
    async deriveKey(password, salt) {
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
                iterations: 100000,
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
        if (padLength > 16 || padLength === 0) {
            return data;
        }
        
        // Verificar padding
        for (let i = 0; i < padLength; i++) {
            if (data[data.length - 1 - i] !== padLength) {
                return data;
            }
        }
        
        return data.slice(0, data.length - padLength);
    }
    
    async calculateSHA256(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(hashBuffer))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    }
    
    base64ToBytes(base64) {
        try {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes;
        } catch (error) {
            throw new Error(`Base64 inválido: ${error.message}`);
        }
    }
    
    getProgress() {
        if (!this.totalBlocks) return 0;
        const dataBlocks = this.totalBlocks - 1; // Excluir bloque de metadatos
        const progress = Math.min(100, Math.round((this.qrData.size / dataBlocks) * 100));
        return progress;
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
        
        // Formato Python
        if (data.i !== undefined && (data.m || data.d)) {
            return 'python';
        }
        
        // Formato Web
        if (data.v && data.v.startsWith('SHZ')) {
            return 'web';
        }
        
        return 'unknown';
    } catch {
        return 'invalid';
    }
}

// Exportar
if (typeof window !== 'undefined') {
    window.SHUMZUCompat = SHUMZUCompat;
    window.detectSHUMZUFormat = detectSHUMZUFormat;
}
