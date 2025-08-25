// Configuración global
const SHUMZU_VERSION = 'SHZv4';
const SALT_SIZE = 16;
const NONCE_SIZE = 12;
const TAG_SIZE = 16;
const RS_RECOVERY = 15; // 15% de símbolos de recuperación Reed-Solomon
const QR_SIZE = 512; // Tamaño de cada código QR en píxeles
const MAX_HISTORY_ITEMS = 20; // Límite de elementos en el historial

let collectedBlocks = new Map();
let totalBlocks = 0;
let metadata = null;
let scannerActive = false;
let videoStream = null;
let filePassword = null;
let isFileEncrypted = false;
let scanAnimationFrame = null;
let processingWorker = null;
let messageCounter = 0; // Contador para IDs de mensajes

// Elementos DOM
const openCameraBtn = document.getElementById('open-camera');
const fileInput = document.getElementById('file-input');
const cameraModal = document.getElementById('camera-modal');
const closeModalBtn = document.getElementById('close-modal');
const cameraStream = document.getElementById('camera-stream');
const reconstructionProgressContainer = document.getElementById('reconstruction-progress-container');
const reconstructionProgressFill = document.getElementById('reconstruction-progress-fill');
const reconstructionProgressPercent = document.getElementById('reconstruction-progress-percent');
const reconstructionProgressDetails = document.getElementById('reconstruction-progress-details');
const uploadProgressContainer = document.getElementById('upload-progress-container');
const uploadProgressFill = document.getElementById('upload-progress-fill');
const uploadProgressPercent = document.getElementById('upload-progress-percent');
const uploadProgressDetails = document.getElementById('upload-progress-details');
const fileInfoSection = document.getElementById('file-info');
const infoName = document.getElementById('info-name');
const infoType = document.getElementById('info-type');
const infoSize = document.getElementById('info-size');
const infoHash = document.getElementById('info-hash');
const infoBlocks = document.getElementById('info-blocks');
const encryptedInfo = document.getElementById('encrypted-info');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history');
const scanStatus = document.getElementById('scan-status');
const reconstructBtn = document.getElementById('reconstruct-btn');
const themeToggle = document.getElementById('theme-toggle');
const passwordModal = document.getElementById('password-modal');
const closePasswordModalBtn = document.getElementById('close-password-modal');
const passwordInput = document.getElementById('password-input');
const confirmPasswordBtn = document.getElementById('confirm-password');
const cancelPasswordBtn = document.getElementById('cancel-password');
const fileDetailsModal = document.getElementById('file-details-modal');
const closeDetailsModalBtn = document.getElementById('close-details-modal');
const fileDetailsContent = document.getElementById('file-details-content');

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    openCameraBtn.addEventListener('click', openCamera);
    closeModalBtn.addEventListener('click', closeCamera);
    fileInput.addEventListener('change', handleFileUpload);
    clearHistoryBtn.addEventListener('click', clearHistory);
    reconstructBtn.addEventListener('click', handleReconstructClick);
    themeToggle.addEventListener('click', toggleTheme);
    closePasswordModalBtn.addEventListener('click', closePasswordModal);
    confirmPasswordBtn.addEventListener('click', confirmPassword);
    cancelPasswordBtn.addEventListener('click', closePasswordModal);
    closeDetailsModalBtn.addEventListener('click', closeDetailsModal);
    
    // Cargar tema desde localStorage
    const savedTheme = localStorage.getItem('shumzu-theme') || 'light';
    setTheme(savedTheme);
    
    // Cargar historial desde localStorage
    loadHistory();
    
    // Agregar listener para tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCamera();
            closePasswordModal();
            closeDetailsModal();
        }
        
        // Enter en modal de contraseña
        if (e.key === 'Enter' && passwordModal.style.display === 'flex') {
            confirmPassword();
        }
    });
    
    // Inicializar Web Worker
    if (window.Worker) {
        processingWorker = new Worker('worker.js');
        processingWorker.onmessage = handleWorkerMessage;
        processingWorker.onerror = (error) => {
            console.error('Error en Worker:', error);
            showNotification('Error en procesamiento de datos', 'error');
        };
    } else {
        showNotification('Web Workers no soportados. Algunas funciones estarán limitadas.', 'warning', 5000);
    }
    
    // Verificar disponibilidad de APIs necesarias
    checkRequiredAPIs();
});

// Verificar APIs necesarias
function checkRequiredAPIs() {
    const requiredAPIs = [
        { name: 'MediaDevices', available: !!navigator.mediaDevices },
        { name: 'Blob', available: !!window.Blob },
        { name: 'FileReader', available: !!window.FileReader },
        { name: 'crypto.subtle', available: !!window.crypto && !!window.crypto.subtle },
        { name: 'Web Workers', available: !!window.Worker }
    ];
    
    const missingAPIs = requiredAPIs.filter(api => !api.available);
    
    if (missingAPIs.length > 0) {
        showNotification(`Funcionalidades no disponibles: ${missingAPIs.map(api => api.name).join(', ')}. Actualiza tu navegador.`, 'error', 10000);
    }
}

// Cambiar entre temas claro y oscuro
function toggleTheme() {
    const currentTheme = document.body.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
}

function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    localStorage.setItem('shumzu-theme', theme);
    themeToggle.textContent = theme === 'light' ? '🌙' : '☀️';
}

// Abrir cámara para escanear QR dinámicos
async function openCamera() {
    try {
        cameraModal.style.display = 'flex';
        videoStream = await navigator.mediaDevices.getUserMedia({ 
            video: { 
                facingMode: 'environment',
                width: { ideal: 1280 },
                height: { ideal: 720 }
            } 
        });
        cameraStream.srcObject = videoStream;
        scannerActive = true;
        startQRScanning();
        updateScanStatus('Cámara activada. Escaneando...', 'info');
    } catch (error) {
        console.error('Error al acceder a la cámara:', error);
        showNotification('No se pudo acceder a la cámara. Asegúrate de permitir el acceso.', 'error');
    }
}

// Cerrar cámara
function closeCamera() {
    scannerActive = false;
    if (scanAnimationFrame) {
        cancelAnimationFrame(scanAnimationFrame);
        scanAnimationFrame = null;
    }
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    cameraModal.style.display = 'none';
    updateScanStatus('', 'info');
}

// Manejar subida de archivos (QR estáticos)
function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;
    
    // Mostrar barra de progreso para la carga
    uploadProgressContainer.style.display = 'block';
    updateUploadProgress(0, files.length);
    
    // Procesar archivos según su tipo
    let processed = 0;
    const totalFiles = files.length;
    
    Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
            processImageFile(file, processed, totalFiles);
        } else if (file.type.startsWith('video/') || file.name.endsWith('.gif')) {
            processVideoFile(file, processed, totalFiles);
        } else {
            console.warn('Formato de archivo no compatible:', file.type);
            processed++;
            updateUploadProgress(processed, totalFiles);
        }
    });
}

// Procesar archivo de imagen
function processImageFile(file, processed, totalFiles) {
    const reader = new FileReader();
    reader.onload = e => {
        const img = new Image();
        img.onload = () => {
            // Verificar si es una matriz (múltiples QR en una imagen)
            if (img.width > QR_SIZE || img.height > QR_SIZE) {
                processMatrixImage(img, file.name, processed, totalFiles);
            } else {
                // Es un QR individual
                decodeQRFromImage(e.target.result, file.name)
                    .then(result => {
                        if (result) {
                            showNotification(`QR decodificado de ${file.name}`, 'success');
                        }
                        processed++;
                        updateUploadProgress(processed, totalFiles);
                        
                        if (processed === totalFiles) {
                            showNotification(`${totalFiles} archivo(s) procesado(s)`, 'info');
                            if (collectedBlocks.size > 0) {
                                reconstructBtn.style.display = 'block';
                            }
                        }
                    })
                    .catch(error => {
                        console.error('Error procesando imagen:', error);
                        showNotification(`Error al procesar ${file.name}`, 'error');
                        processed++;
                        updateUploadProgress(processed, totalFiles);
                    });
            }
        };
        img.onerror = () => {
            console.error('Error cargando imagen:', file.name);
            processed++;
            updateUploadProgress(processed, totalFiles);
        };
        img.src = e.target.result;
    };
    reader.onerror = () => {
        console.error('Error leyendo archivo:', file.name);
        processed++;
        updateUploadProgress(processed, totalFiles);
    };
    reader.readAsDataURL(file);
}

// Procesar imagen matricial (múltiples QR)
function processMatrixImage(img, filename, processed, totalFiles) {
    const cols = Math.floor(img.width / QR_SIZE);
    const rows = Math.floor(img.height / QR_SIZE);
    const totalTiles = cols * rows;
    let decodedTiles = 0;
    
    if (totalTiles === 0) {
        processed++;
        updateUploadProgress(processed, totalFiles);
        return;
    }
    
    const canvas = document.createElement('canvas');
    canvas.width = QR_SIZE;
    canvas.height = QR_SIZE;
    const ctx = canvas.getContext('2d');
    
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            // Dibujar el tile en el canvas
            ctx.clearRect(0, 0, QR_SIZE, QR_SIZE);
            ctx.drawImage(
                img, 
                col * QR_SIZE, 
                row * QR_SIZE, 
                QR_SIZE, 
                QR_SIZE,
                0, 
                0, 
                QR_SIZE, 
                QR_SIZE
            );
            
            // Convertir a data URL y decodificar
            const dataUrl = canvas.toDataURL('image/png');
            decodeQRFromImage(dataUrl, `${filename}_tile_${row}_${col}`)
                .then(result => {
                    decodedTiles++;
                    if (decodedTiles === totalTiles) {
                        processed++;
                        updateUploadProgress(processed, totalFiles);
                        
                        if (processed === totalFiles) {
                            showNotification(`${totalFiles} archivo(s) procesado(s)`, 'info');
                            if (collectedBlocks.size > 0) {
                                reconstructBtn.style.display = 'block';
                            }
                        }
                    }
                })
                .catch(error => {
                    console.error(`Error procesando tile ${row}-${col}:`, error);
                    decodedTiles++;
                    if (decodedTiles === totalTiles) {
                        processed++;
                        updateUploadProgress(processed, totalFiles);
                    }
                });
        }
    }
}

// Procesar archivo de video o GIF
function processVideoFile(file, processed, totalFiles) {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    
    let framesProcessed = 0;
    let decodedFrames = 0;
    
    video.onloadedmetadata = () => {
        const duration = video.duration;
        // Limitar a 100 frames máximo para no sobrecargar
        const frameCount = Math.min(100, Math.floor(duration * 3));
        
        if (frameCount === 0) {
            processed++;
            updateUploadProgress(processed, totalFiles);
            URL.revokeObjectURL(url);
            return;
        }
        
        // Extraer frames a intervalos regulares
        const processNextFrame = (index) => {
            if (index >= frameCount) {
                URL.revokeObjectURL(url);
                processed++;
                updateUploadProgress(processed, totalFiles);
                
                if (processed === totalFiles) {
                    showNotification(`${totalFiles} archivo(s) procesado(s)`, 'info');
                    if (collectedBlocks.size > 0) {
                        reconstructBtn.style.display = 'block';
                    }
                }
                return;
            }
            
            const time = (index / frameCount) * duration;
            video.currentTime = time;
            
            video.onseeked = () => {
                // Capturar frame actual
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                
                // Decodificar QR del frame
                decodeQRFromImage(canvas.toDataURL(), `frame_${index}`)
                    .then(result => {
                        if (result) decodedFrames++;
                        framesProcessed++;
                        
                        if (framesProcessed === frameCount) {
                            showNotification(`${decodedFrames} frames decodificados de ${file.name}`, 'info');
                        }
                        
                        // Procesar siguiente frame
                        processNextFrame(index + 1);
                    })
                    .catch(error => {
                        console.error('Error procesando frame:', error);
                        framesProcessed++;
                        processNextFrame(index + 1);
                    });
            };
        };
        
        processNextFrame(0);
    };
    
    video.onerror = () => {
        console.error('Error cargando video:', file.name);
        URL.revokeObjectURL(url);
        processed++;
        updateUploadProgress(processed, totalFiles);
    };
    
    video.load();
}

// Decodificar QR desde imagen
function decodeQRFromImage(dataUrl, filename) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0, img.width, img.height);
            
            try {
                const imageData = ctx.getImageData(0, 0, img.width, img.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                });
                
                if (code) {
                    processQRData(code.data, filename);
                    resolve(true);
                } else {
                    console.warn('No se detectó código QR en la imagen:', filename);
                    resolve(false);
                }
            } catch (error) {
                reject(error);
            }
        };
        img.onerror = reject;
        img.src = dataUrl;
    });
}

// Actualizar progreso de carga de archivos
function updateUploadProgress(processed, total) {
    const progress = Math.round((processed / total) * 100);
    uploadProgressPercent.textContent = `${progress}%`;
    uploadProgressFill.style.width = `${progress}%`;
    uploadProgressDetails.textContent = `${processed}/${total} archivos procesados`;
    
    // Ocultar barra de progreso cuando se complete
    if (processed === total) {
        setTimeout(() => {
            uploadProgressContainer.style.display = 'none';
        }, 2000);
    }
}

// Iniciar escaneo continuo desde cámara
function startQRScanning() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let lastScanTime = 0;
    const scanInterval = 300; // Escanear cada 300ms para mejorar rendimiento
    
    function scanFrame() {
        if (!scannerActive || !videoStream) return;
        
        const currentTime = Date.now();
        if (currentTime - lastScanTime < scanInterval) {
            scanAnimationFrame = requestAnimationFrame(scanFrame);
            return;
        }
        
        lastScanTime = currentTime;
        
        if (cameraStream.readyState === cameraStream.HAVE_ENOUGH_DATA) {
            canvas.width = cameraStream.videoWidth;
            canvas.height = cameraStream.videoHeight;
            ctx.drawImage(cameraStream, 0, 0, canvas.width, canvas.height);
            
            try {
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height, {
                    inversionAttempts: 'dontInvert',
                });
                
                if (code) {
                    processQRData(code.data, 'live-camera');
                    // Feedback visual breve al detectar QR
                    cameraStream.style.border = '3px solid #4CAF50';
                    setTimeout(() => {
                        if (cameraStream) cameraStream.style.border = 'none';
                    }, 300);
                }
            } catch (error) {
                console.error('Error en escaneo:', error);
            }
        }
        
        if (scannerActive) {
            scanAnimationFrame = requestAnimationFrame(scanFrame);
        }
    }
    
    scanAnimationFrame = requestAnimationFrame(scanFrame);
}

// Procesar datos del QR
function processQRData(data, source) {
    try {
        const qrData = JSON.parse(data);
        
        // Validar formato SHUMZU
        if (!qrData.v || qrData.v !== SHUMZU_VERSION) {
            console.warn('QR no válido (versión incorrecta):', source);
            return;
        }
        
        const index = qrData.i;
        const encodedData = qrData.d;
        
        // Si es el bloque de metadatos (índice 0)
        if (index === 0) {
            try {
                // Decodificar metadatos
                const decodedMetadata = atob(encodedData);
                metadata = JSON.parse(decodedMetadata);
                totalBlocks = metadata.tb;
                
                // Mostrar información del archivo
                displayFileInfo(metadata);
                showNotification(`Archivo detectado: ${metadata.n} (${totalBlocks-1} bloques)`, 'info');
                
                // Mostrar contenedor de progreso
                reconstructionProgressContainer.style.display = 'block';
                updateReconstructionProgress();
                
                // Verificar si el archivo está cifrado
                if (metadata.e) { // Campo 'e' indica si está cifrado
                    isFileEncrypted = true;
                    encryptedInfo.style.display = 'flex';
                }
            } catch (e) {
                console.error('Error al procesar metadatos:', e);
                return;
            }
        }
        
        // Almacenar bloque
        if (!collectedBlocks.has(index)) {
            collectedBlocks.set(index, encodedData);
            console.log(`Bloque ${index} recibido de: ${source}`);
            
            // Actualizar estado de escaneo
            if (source === 'live-camera') {
                updateScanStatus(`Bloque ${index}/${totalBlocks-1} escaneado`, 'success');
            }
            
            updateReconstructionProgress();
            
            // Mostrar el botón de reconstruir si hay bloques
            if (collectedBlocks.size > 0) {
                reconstructBtn.style.display = 'block';
            }
            
            // Verificar si tenemos todos los bloques
            if (collectedBlocks.size === totalBlocks && totalBlocks > 0) {
                showNotification('¡Todos los bloques recibidos! Reconstruyendo archivo...', 'success');
                setTimeout(() => {
                    if (isFileEncrypted) {
                        openPasswordModal();
                    } else {
                        reconstructFile();
                    }
                }, 1000);
            }
        } else {
            if (source === 'live-camera') {
                updateScanStatus(`Bloque ${index} ya fue escaneado`, 'info');
            }
        }
    } catch (error) {
        console.error('Error al procesar datos QR:', error, data);
    }
}

// Mostrar información del archivo
function displayFileInfo(metadata) {
    fileInfoSection.style.display = 'block';
    infoName.textContent = metadata.n;
    infoType.textContent = metadata.t || 'Desconocido';
    infoSize.textContent = metadata.s ? formatFileSize(metadata.s) : 'Desconocido';
    infoHash.textContent = metadata.h || 'No disponible';
    infoBlocks.textContent = `${metadata.tb - 1} bloques`;
}

// Formatear tamaño de archivo
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Actualizar barra de progreso de reconstrucción
function updateReconstructionProgress() {
    if (totalBlocks <= 0) {
        // Si no tenemos metadatos, mostramos el número de bloques recolectados
        reconstructionProgressPercent.textContent = `${collectedBlocks.size} bloques`;
        reconstructionProgressFill.style.width = '0%';
        reconstructionProgressDetails.textContent = `Esperando metadatos...`;
        return;
    }
    
    const progress = Math.round((collectedBlocks.size / totalBlocks) * 100);
    reconstructionProgressPercent.textContent = `${progress}%`;
    reconstructionProgressFill.style.width = `${progress}%`;
    reconstructionProgressDetails.textContent = `${collectedBlocks.size}/${totalBlocks} bloques escaneados`;
    
    // Cambiar color según el progreso
    if (progress < 30) {
        reconstructionProgressFill.style.background = 'var(--error-color)';
    } else if (progress < 70) {
        reconstructionProgressFill.style.background = 'var(--warning-color)';
    } else {
        reconstructionProgressFill.style.background = 'var(--success-color)';
    }
}

// Manejar clic en el botón de reconstruir
function handleReconstructClick() {
    if (collectedBlocks.size > 0) {
        if (isFileEncrypted) {
            openPasswordModal();
        } else {
            reconstructFile();
        }
    }
}

// Abrir modal de contraseña
function openPasswordModal() {
    passwordModal.style.display = 'flex';
    passwordInput.focus();
}

// Cerrar modal de contraseña
function closePasswordModal() {
    passwordModal.style.display = 'none';
    passwordInput.value = '';
    filePassword = null;
}

// Abrir modal de detalles
function openDetailsModal(content) {
    fileDetailsContent.innerHTML = content;
    fileDetailsModal.style.display = 'flex';
}

// Cerrar modal de detalles
function closeDetailsModal() {
    fileDetailsModal.style.display = 'none';
}

// Confirmar contraseña
function confirmPassword() {
    filePassword = passwordInput.value.trim();
    if (!filePassword) {
        showNotification('Por favor, introduce una contraseña', 'warning');
        return;
    }
    closePasswordModal();
    reconstructFile();
}

// Derivar clave con Argon2
async function deriveKey(salt, password) {
    try {
        const key = await argon2.hash({
            pass: password,
            salt: salt,
            type: argon2.ArgonType.Argon2id,
            time: 2,
            mem: 102400,
            parallelism: navigator.hardwareConcurrency || 4,
            hashLen: 32
        });
        return key.hash;
    } catch (error) {
        console.error('Error derivando clave:', error);
        throw new Error('Error en derivación de clave');
    }
}

// Descifrar datos
async function decryptData(encryptedData, password) {
    try {
        const salt = encryptedData.slice(0, SALT_SIZE);
        const nonce = encryptedData.slice(SALT_SIZE, SALT_SIZE + NONCE_SIZE);
        const ciphertext = encryptedData.slice(SALT_SIZE + NONCE_SIZE);
        
        const key = await deriveKey(salt, password);
        
        // AES-GCM
        const algorithm = { name: 'AES-GCM', iv: nonce };
        const cryptoKey = await crypto.subtle.importKey('raw', key, algorithm, false, ['decrypt']);
        
        const decrypted = await crypto.subtle.decrypt(algorithm, cryptoKey, ciphertext);
        return new Uint8Array(decrypted);
    } catch (error) {
        console.error('Error descifrando datos:', error);
        throw new Error('Error en descifrado - contraseña incorrecta');
    }
}

// Aplicar corrección de errores Reed-Solomon
function applyReedSolomon(data) {
    try {
        // Crear codec con el mismo nivel de corrección que Python
        const rs = new ReedSolomon(RS_RECOVERY);
        return rs.decode(data);
    } catch (error) {
        console.error('Error en corrección Reed-Solomon:', error);
        throw new Error('Error en corrección de errores');
    }
}

// Descomprimir datos con pako (gzip)
function decompressData(data) {
    try {
        return pako.inflate(data);
    } catch (error) {
        console.error('Error descomprimiendo datos:', error);
        throw new Error('Error en descompresión');
    }
}

// Calcular hash BLAKE2b
async function calculateBlake2bHash(data) {
    try {
        // Usar la librería blake2b
        const hash = blake2b(32); // 32 bytes = 256 bits
        hash.update(new Uint8Array(data));
        return Array.from(new Uint8Array(hash.digest()))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
    } catch (error) {
        console.error('Error calculando hash:', error);
        throw new Error('Error en cálculo de hash');
    }
}

// Reconstruir archivo desde los bloques
async function reconstructFile() {
    if (!metadata) {
        showNotification('No hay metadatos. No se puede reconstruir el archivo.', 'error');
        return;
    }
    
    if (collectedBlocks.size < totalBlocks) {
        const shouldForce = confirm(`Faltan ${totalBlocks - collectedBlocks.size} bloques. ¿Deseas intentar reconstruir igualmente?`);
        if (!shouldForce) {
            return;
        }
    }
    
    try {
        showNotification('Reconstruyendo archivo...', 'info');
        reconstructBtn.disabled = true;
        
        // Preparar datos para el Worker
        const reconstructionData = {
            blocks: Array.from(collectedBlocks.entries()),
            metadata: metadata,
            password: filePassword,
            isEncrypted: isFileEncrypted
        };
        
        // Enviar al Worker para procesamiento
        if (processingWorker) {
            const messageId = messageCounter++;
            processingWorker.postMessage({
                type: 'init',
                data: {
                    metadata: metadata,
                    password: filePassword,
                    isEncrypted: isFileEncrypted
                },
                id: messageId
            });
            
            // Enviar bloques uno por uno
            for (const [index, encodedData] of collectedBlocks.entries()) {
                processingWorker.postMessage({
                    type: 'process-block',
                    data: { index, encodedData },
                    id: messageId
                });
            }
            
            // Finalizar
            processingWorker.postMessage({
                type: 'finalize',
                id: messageId
            });
        } else {
            // Fallback si no hay Worker
            const result = await reconstructInMainThread(reconstructionData);
            handleReconstructionResult(result);
        }
        
    } catch (error) {
        console.error('Error al reconstruir archivo:', error);
        showNotification('Error al reconstruir el archivo: ' + error.message, 'error');
        reconstructBtn.disabled = false;
    }
}

// Reconstruir en el hilo principal (fallback)
async function reconstructInMainThread(data) {
    const { blocks, metadata, password, isEncrypted } = data;
    
    // Ordenar bloques por índice
    const sortedBlocks = blocks.sort((a, b) => a[0] - b[0]);
    let compressedData = new Uint8Array(metadata.c); // metadata.c es el tamaño comprimido
    
    // Procesar cada bloque (excepto el 0 que son metadatos)
    for (let i = 1; i < metadata.tb; i++) {
        const block = sortedBlocks.find(b => b[0] === i);
        if (block) {
            let blockData = block[1];
            
            // Decodificar base64
            let encryptedData = base64ToBytes(blockData);
            
            // Descifrar si hay contraseña
            let decryptedData;
            if (isEncrypted && password) {
                decryptedData = await decryptData(encryptedData, password);
            } else {
                decryptedData = encryptedData;
            }
            
            // Aplicar corrección Reed-Solomon
            let correctedData = applyReedSolomon(decryptedData);
            
            // Colocar en la posición correcta
            let start = (i-1) * metadata.b; // metadata.b es el tamaño de bloque
            let end = Math.min(start + correctedData.length, compressedData.length);
            compressedData.set(new Uint8Array(correctedData).subarray(0, end - start), start);
        } else {
            // Rellenar con zeros si falta el bloque
            let start = (i-1) * metadata.b;
            let end = Math.min(start + metadata.b, metadata.c);
            compressedData.fill(0, start, end);
        }
    }
    
    // Descomprimir
    let decompressedData = decompressData(compressedData);
    
    // Verificar hash
    let fileHash = await calculateBlake2bHash(decompressedData);
    const hashMatches = fileHash === metadata.h;
    
    return {
        decompressedData: decompressedData,
        metadata: metadata,
        hashMatches: hashMatches,
        fileHash: fileHash
    };
}

// Manejar mensajes del Worker
function handleWorkerMessage(event) {
    const { type, data, id } = event.data;
    
    if (type === 'progress') {
        // Actualizar progreso
        updateReconstructionProgress(data);
    } else if (type === 'result') {
        // Procesar resultado
        handleReconstructionResult(data);
        reconstructBtn.disabled = false;
    } else if (type === 'error') {
        // Manejar error
        console.error('Error en Worker:', data);
        showNotification('Error al reconstruir el archivo: ' + data, 'error');
        reconstructBtn.disabled = false;
    } else if (type === 'ack') {
        // Confirmación de procesamiento
        console.log('Mensaje procesado por worker:', id);
    }
}

// Manejar resultado de la reconstrucción
function handleReconstructionResult(result) {
    const { decompressedData, metadata, hashMatches, fileHash, recoveredBlocks, totalBlocks } = result;
    
    // Verificar hash
    if (!hashMatches) {
        showNotification('Advertencia: El hash del archivo no coincide con el original. El archivo puede estar corrupto.', 'warning', 7000);
    }
    
    // Crear y descargar archivo
    const blob = new Blob([decompressedData], { type: metadata.t });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = metadata.n;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Guardar en historial
    saveToHistory(metadata.n, metadata.t, decompressedData.length, fileHash, totalBlocks, recoveredBlocks);
    
    showNotification(`Archivo reconstruido: ${metadata.n}`, 'success');
    
    // Reiniciar para nuevo escaneo
    resetScanner();
}

// Utilidad: Base64 a bytes
function base64ToBytes(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Guardar en historial
function saveToHistory(name, type, size, hash, totalBlocks, recoveredBlocks) {
    const history = getHistory();
    const newItem = {
        id: Date.now(),
        name,
        type,
        size,
        hash,
        totalBlocks,
        recoveredBlocks,
        date: new Date().toISOString()
    };
    
    history.unshift(newItem);
    // Mantener solo los últimos elementos
    if (history.length > MAX_HISTORY_ITEMS) {
        history.splice(MAX_HISTORY_ITEMS);
    }
    
    localStorage.setItem('shumzuHistory', JSON.stringify(history));
    loadHistory();
}

// Obtener historial desde localStorage
function getHistory() {
    const historyJSON = localStorage.getItem('shumzuHistory');
    return historyJSON ? JSON.parse(historyJSON) : [];
}

// Cargar historial en la UI
function loadHistory() {
    const history = getHistory();
    historyList.innerHTML = '';
    
    if (history.length === 0) {
        historyList.innerHTML = '<p class="no-history">No hay archivos reconstruidos recientemente</p>';
        return;
    }
    
    history.forEach(item => {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        
        historyItem.innerHTML = `
            <div class="history-info">
                <div class="history-name">${item.name}</div>
                <div class="history-details">
                    ${formatFileSize(item.size)} • ${new Date(item.date).toLocaleDateString()} • ${item.recoveredBlocks || item.blocks}/${item.totalBlocks || item.blocks} bloques
                </div>
            </div>
            <button class="download-btn" data-id="${item.id}">Ver detalles</button>
        `;
        
        historyList.appendChild(historyItem);
    });
    
    // Agregar event listeners a los botones de detalles
    document.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.getAttribute('data-id'));
            showHistoryItemDetails(id);
        });
    });
}

// Mostrar detalles de un elemento del historial
function showHistoryItemDetails(id) {
    const history = getHistory();
    const item = history.find(i => i.id === id);
    
    if (!item) return;
    
    const content = `
        <div class="info-grid">
            <div class="info-item">
                <label>Nombre:</label>
                <span>${item.name}</span>
            </div>
            <div class="info-item">
                <label>Tipo:</label>
                <span>${item.type}</span>
            </div>
            <div class="info-item">
                <label>Tamaño:</label>
                <span>${formatFileSize(item.size)}</span>
            </div>
            <div class="info-item">
                <label>Hash (BLAKE2b):</label>
                <span class="hash-value">${item.hash}</span>
            </div>
            <div class="info-item">
                <label>Bloques recuperados:</label>
                <span>${item.recoveredBlocks || item.blocks}/${item.totalBlocks || item.blocks}</span>
            </div>
            <div class="info-item">
                <label>Fecha:</label>
                <span>${new Date(item.date).toLocaleString()}</span>
            </div>
        </div>
        <div class="modal-actions">
            <button class="btn-primary" onclick="navigator.clipboard.writeText('${item.hash}').then(() => showNotification('Hash copiado al portapapeles', 'success'))">Copiar hash</button>
        </div>
    `;
    
    openDetailsModal(content);
}

// Limpiar historial
function clearHistory() {
    if (confirm('¿Estás seguro de que quieres borrar todo el historial?')) {
        localStorage.removeItem('shumzuHistory');
        loadHistory();
        showNotification('Historial borrado', 'info');
    }
}

// Mostrar notificación
function showNotification(message, type = 'info', duration = 5000) {
    // Eliminar notificación anterior si existe
    const existingNotification = document.getElementById('shumzu-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Crear nueva notificación
    const notification = document.createElement('div');
    notification.id = 'shumzu-notification';
    notification.className = `notification ${type}`;
    
    // Icono según el tipo
    let icon = 'ℹ️';
    if (type === 'error') icon = '❌';
    if (type === 'success') icon = '✅';
    if (type === 'warning') icon = '⚠️';
    
    notification.innerHTML = `
        <span class="notification-icon">${icon}</span>
        <span class="notification-message">${message}</span>
    `;
    
    document.body.appendChild(notification);
    
    // Auto-eliminar después del tiempo especificado
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, duration);
}

// Actualizar estado de escaneo
function updateScanStatus(message, type) {
    scanStatus.textContent = message;
    scanStatus.className = 'scan-status';
    if (type) {
        scanStatus.classList.add(type);
    }
}

// Reiniciar escáner
function resetScanner() {
    collectedBlocks.clear();
    totalBlocks = 0;
    metadata = null;
    filePassword = null;
    isFileEncrypted = false;
    reconstructionProgressContainer.style.display = 'none';
    fileInfoSection.style.display = 'none';
    encryptedInfo.style.display = 'none';
    reconstructBtn.style.display = 'none';
    reconstructBtn.disabled = false;
    console.log('Escáner reiniciado, listo para nuevo escaneo');
}

// Inicializar cuando se carga la página
window.addEventListener('load', async () => {
    try {
        // Verificar que las librerías estén cargadas
        if (typeof jsQR === 'undefined') {
            throw new Error('No se pudo cargar jsQR');
        }
        
        if (typeof pako === 'undefined') {
            throw new Error('No se pudo cargar pako (compresión)');
        }
        
        if (typeof argon2 === 'undefined') {
            throw new Error('No se pudo cargar Argon2');
        }
        
        if (typeof ReedSolomon === 'undefined') {
            throw new Error('No se pudo cargar ReedSolomon');
        }
        
        console.log('SHUMZU Web App inicializada correctamente');
        showNotification('SHUMZU está listo para escanear códigos QR', 'success', 3000);
    } catch (error) {
        console.error('Error al inicializar SHUMZU:', error);
        showNotification('Error al cargar las dependencias necesarias', 'error');
    }
});
