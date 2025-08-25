// Web Worker optimizado para procesamiento de SHUMZU
const SHUMZU_VERSION = 'SHZv4';
const SALT_SIZE = 16;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const RS_RECOVERY = 15;

// Importar scripts necesarios
importScripts(
    'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js',
    'https://cdn.jsdelivr.net/npm/blake2b@1.2.0/blake2b.min.js',
    'https://cdn.jsdelivr.net/npm/argon2-browser@1.18.0/lib/argon2.js'
);

// Buffer para almacenamiento eficiente de datos
let compressedData = null;
let currentProgress = 0;

// Manejar mensajes del hilo principal
self.onmessage = async function(event) {
    const { type, data } = event.data;
    
    try {
        switch (type) {
            case 'init':
                await initializeReconstruction(data);
                break;
                
            case 'process-block':
                await processBlock(data);
                break;
                
            case 'finalize':
                await finalizeReconstruction();
                break;
                
            case 'cancel':
                resetWorker();
                break;
                
            default:
                throw new Error(`Tipo de mensaje no reconocido: ${type}`);
        }
    } catch (error) {
        self.postMessage({
            type: 'error',
            data: error.message
        });
    }
};

// Inicializar la reconstrucción
async function initializeReconstruction(config) {
    const { metadata, password, isEncrypted } = config;
    
    // Validar metadatos
    if (!metadata || !metadata.tb || !metadata.c || !metadata.b) {
        throw new Error('Metadatos incompletos para la reconstrucción');
    }
    
    // Preparar buffer para datos comprimidos
    compressedData = new Uint8Array(metadata.c);
    
    // Almacenar configuración
    self.metadata = metadata;
    self.password = password;
    self.isEncrypted = isEncrypted;
    self.processedBlocks = new Set();
    
    // Notificar inicialización exitosa
    self.postMessage({
        type: 'initialized',
        data: {
            totalBlocks: metadata.tb - 1,
            compressedSize: metadata.c
        }
    });
}

// Procesar un bloque individual
async function processBlock(blockData) {
    if (!compressedData || !self.metadata) {
        throw new Error('Worker no inicializado. Llama a init primero.');
    }
    
    const { index, encodedData } = blockData;
    
    // Verificar si ya procesamos este bloque
    if (self.processedBlocks.has(index)) {
        self.postMessage({
            type: 'progress',
            data: {
                current: currentProgress,
                total: self.metadata.tb - 1,
                skipped: true
            }
        });
        return;
    }
    
    try {
        // Decodificar base64
        const encryptedData = base64ToBytes(encodedData);
        
        // Descifrar si es necesario
        let decryptedData;
        if (self.isEncrypted && self.password) {
            decryptedData = await decryptData(encryptedData, self.password);
        } else {
            decryptedData = encryptedData;
        }
        
        // Aplicar corrección Reed-Solomon
        const correctedData = applyReedSolomon(decryptedData);
        
        // Colocar en la posición correcta
        const startPos = (index - 1) * self.metadata.b;
        const endPos = Math.min(startPos + correctedData.length, compressedData.length);
        
        compressedData.set(correctedData.subarray(0, endPos - startPos), startPos);
        
        // Marcar como procesado
        self.processedBlocks.add(index);
        currentProgress = self.processedBlocks.size;
        
        // Notificar progreso
        self.postMessage({
            type: 'progress',
            data: {
                current: currentProgress,
                total: self.metadata.tb - 1,
                index: index
            }
        });
        
    } catch (error) {
        console.error(`Error procesando bloque ${index}:`, error);
        throw new Error(`Error en bloque ${index}: ${error.message}`);
    }
}

// Finalizar la reconstrucción
async function finalizeReconstruction() {
    if (!compressedData || !self.metadata) {
        throw new Error('No hay datos para finalizar');
    }
    
    try {
        // Descomprimir datos
        const decompressedData = pako.inflate(compressedData);
        
        // Calcular hash
        const fileHash = await calculateBlake2bHash(decompressedData);
        const hashMatches = fileHash === self.metadata.h;
        
        // Enviar resultado al hilo principal
        self.postMessage({
            type: 'result',
            data: {
                decompressedData: decompressedData,
                metadata: self.metadata,
                hashMatches: hashMatches,
                fileHash: fileHash,
                recoveredBlocks: self.processedBlocks.size,
                totalBlocks: self.metadata.tb - 1
            }
        });
        
        // Limpiar
        resetWorker();
        
    } catch (error) {
        throw new Error(`Error finalizando reconstrucción: ${error.message}`);
    }
}

// Reiniciar el worker
function resetWorker() {
    compressedData = null;
    currentProgress = 0;
    self.metadata = null;
    self.password = null;
    self.isEncrypted = false;
    
    if (self.processedBlocks) {
        self.processedBlocks.clear();
    }
}

// Utilidad: Base64 a bytes
function base64ToBytes(base64) {
    try {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        throw new Error(`Error decodificando base64: ${error.message}`);
    }
}

// Aplicar corrección de errores Reed-Solomon
function applyReedSolomon(data) {
    try {
        const rs = new ReedSolomon(RS_RECOVERY);
        return rs.decode(data);
    } catch (error) {
        throw new Error(`Error en corrección Reed-Solomon: ${error.message}`);
    }
}

// Calcular hash BLAKE2b
async function calculateBlake2bHash(data) {
    try {
        const hash = blake2b(32);
        hash.update(new Uint8Array(data));
        return Array.from(new Uint8Array(hash.digest()))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } catch (error) {
        throw new Error(`Error calculando hash: ${error.message}`);
    }
}

// Descifrar datos
async function decryptData(encryptedData, password) {
    try {
        // Extraer salt y nonce
        const salt = encryptedData.slice(0, SALT_SIZE);
        const nonce = encryptedData.slice(SALT_SIZE, SALT_SIZE + NONCE_SIZE);
        const ciphertext = encryptedData.slice(SALT_SIZE + NONCE_SIZE);
        
        // Derivar clave con Argon2
        const key = await argon2.hash({
            pass: password,
            salt: salt,
            type: argon2.ArgonType.Argon2id,
            time: 2,
            mem: 102400,
            parallelism: 4, // Valor fijo para consistencia en worker
            hashLen: 32
        });
        
        // Preparar algoritmo de descifrado
        const algorithm = { 
            name: 'AES-GCM', 
            iv: nonce 
        };
        
        // Importar clave
        const cryptoKey = await crypto.subtle.importKey(
            'raw', 
            key.hash, 
            algorithm, 
            false, 
            ['decrypt']
        );
        
        // Descifrar
        const decrypted = await crypto.subtle.decrypt(
            {
                name: 'AES-GCM',
                iv: nonce,
                tagLength: TAG_SIZE * 8
            },
            cryptoKey,
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

// Manejar errores no capturados
self.onerror = function(error) {
    self.postMessage({
        type: 'error',
        data: `Error no capturado en worker: ${error.message}`
    });
    resetWorker();
};
