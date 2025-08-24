// Configuración global
const SHUMZU_VERSION = 'SHZv4';
const QR_SIZE = 512;
let collectedBlocks = new Map();
let totalBlocks = 0;
let metadata = null;
let scannerActive = false;
let videoStream = null;

// Elementos DOM
const openCameraBtn = document.getElementById('open-camera');
const fileInput = document.getElementById('file-input');
const cameraModal = document.getElementById('camera-modal');
const closeModalBtn = document.getElementById('close-modal');
const cameraStream = document.getElementById('camera-stream');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressPercent = document.getElementById('progress-percent');
const progressDetails = document.getElementById('progress-details');
const fileInfoSection = document.getElementById('file-info');
const infoName = document.getElementById('info-name');
const infoType = document.getElementById('info-type');
const infoSize = document.getElementById('info-size');
const infoHash = document.getElementById('info-hash');
const infoBlocks = document.getElementById('info-blocks');
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history');
const scanStatus = document.getElementById('scan-status');
const reconstructBtn = document.getElementById('reconstruct-btn');
const themeToggle = document.getElementById('theme-toggle');

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    openCameraBtn.addEventListener('click', openCamera);
    closeModalBtn.addEventListener('click', closeCamera);
    fileInput.addEventListener('change', handleFileUpload);
    clearHistoryBtn.addEventListener('click', clearHistory);
    reconstructBtn.addEventListener('click', () => {
        if (collectedBlocks.size > 0) {
            reconstructFile();
        }
    });
    themeToggle.addEventListener('click', toggleTheme);
    
    // Cargar tema desde localStorage
    const savedTheme = localStorage.getItem('shumzu-theme') || 'light';
    setTheme(savedTheme);
    
    // Cargar historial desde localStorage
    loadHistory();
    
    // Agregar listener para tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeCamera();
        }
    });
});

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
    
    let processed = 0;
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
            processImageFile(e.target.result, file.name);
            processed++;
            if (processed === files.length) {
                showNotification(`${files.length} archivo(s) subido(s) para procesar`, 'info');
                // Mostrar el botón de reconstruir si hay bloques
                if (collectedBlocks.size > 0) {
                    reconstructBtn.style.display = 'block';
                }
            }
        };
        reader.readAsDataURL(file);
    });
}

// Procesar imagen de QR estático
function processImageFile(dataUrl, filename) {
    const img = new Image();
    img.onload = () => decodeQRFromImage(img, filename);
    img.src = dataUrl;
}

// Decodificar QR desde imagen
function decodeQRFromImage(img, filename) {
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
        } else {
            console.warn('No se detectó código QR en la imagen:', filename);
            showNotification(`No se detectó QR en ${filename}`, 'warning');
        }
    } catch (error) {
        console.error('Error al procesar imagen:', error);
        showNotification(`Error al procesar ${filename}`, 'error');
    }
}

// Iniciar escaneo continuo desde cámara
function startQRScanning() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    function scanFrame() {
        if (!scannerActive || !videoStream) return;
        
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
            requestAnimationFrame(scanFrame);
        }
    }
    
    scanFrame();
}

// Procesar datos del QR
function processQRData(data, source) {
    try {
        const qrData = JSON.parse(data);
        
        // Validar formato SHUMZU
        if (!qrData.v || qrData.v !== SHUMZU_VERSION) {
            console.warn('QR no válido (versión incorrecta):', source);
            showNotification('Código QR no compatible con SHUMZU', 'warning');
            return;
        }
        
        const index = qrData.i;
        const encodedData = qrData.d;
        
        // Si es el bloque de metadatos (índice 0)
        if (index === 0) {
            try {
                metadata = JSON.parse(atob(encodedData));
                totalBlocks = metadata.tb;
                console.log('Metadatos recibidos:', metadata);
                
                // Mostrar información del archivo
                displayFileInfo(metadata);
                showNotification(`Archivo detectado: ${metadata.n} (${totalBlocks-1} bloques)`, 'info');
                
                // Mostrar contenedor de progreso
                progressContainer.style.display = 'block';
                updateProgress();
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
            
            updateProgress();
            
            // Mostrar el botón de reconstruir si hay bloques
            if (collectedBlocks.size > 0) {
                reconstructBtn.style.display = 'block';
            }
            
            // Verificar si tenemos todos los bloques
            if (collectedBlocks.size === totalBlocks && totalBlocks > 0) {
                showNotification('¡Todos los bloques recibidos! Reconstruyendo archivo...', 'success');
                setTimeout(reconstructFile, 1000);
            }
        } else {
            if (source === 'live-camera') {
                updateScanStatus(`Bloque ${index} ya fue escaneado`, 'info');
            }
        }
    } catch (error) {
        console.error('Error al procesar datos QR:', error, data);
        showNotification('Error al procesar código QR', 'error');
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

// Actualizar barra de progreso
function updateProgress() {
    if (totalBlocks <= 0) {
        // Si no tenemos metadatos, mostramos el número de bloques recolectados
        progressPercent.textContent = `${collectedBlocks.size} bloques`;
        progressFill.style.width = '0%';
        progressDetails.textContent = `Esperando metadatos...`;
        return;
    }
    
    const progress = Math.round((collectedBlocks.size / totalBlocks) * 100);
    progressPercent.textContent = `${progress}%`;
    progressFill.style.width = `${progress}%`;
    progressDetails.textContent = `${collectedBlocks.size}/${totalBlocks} bloques escaneados`;
    
    // Cambiar color según el progreso
    if (progress < 30) {
        progressFill.style.background = 'var(--error-color)';
    } else if (progress < 70) {
        progressFill.style.background = 'var(--warning-color)';
    } else {
        progressFill.style.background = 'var(--success-color)';
    }
}

// Reconstruir archivo desde los bloques
async function reconstructFile() {
    // Si no tenemos metadatos, intentamos reconstruir con los bloques que tenemos
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
        
        // Ordenar bloques por índice
        const sortedIndices = Array.from(collectedBlocks.keys()).sort((a, b) => a - b);
        let compressedData = '';
        
        // Concatenar datos (omitir metadatos en índice 0)
        for (let i = 1; i < totalBlocks; i++) {
            if (collectedBlocks.has(i)) {
                compressedData += collectedBlocks.get(i);
            } else {
                // Si falta un bloque y forzamos la reconstrucción, usamos cadena vacía
                compressedData += '';
                console.warn(`Falta el bloque ${i}, usando cadena vacía`);
            }
        }
        
        // Decodificar de Base64
        const compressedBytes = base64ToBytes(compressedData);
        
        // Aquí iría la lógica de descompresión LZ4 y descifrado
        // Por ahora simulamos la reconstrucción
        console.log('Datos comprimidos recibidos:', compressedBytes.length, 'bytes');
        
        // Simular descompresión (en un caso real usarías LZ4)
        const decompressedData = compressedBytes; // Esto sería reemplazado por LZ4.decompress(compressedBytes)
        
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
        
        // Calcular hash del archivo reconstruido (SHA-256)
        const fileHash = await calculateFileHash(blob);
        
        // Verificar integridad si hay hash en metadatos
        if (metadata.h && metadata.h !== fileHash) {
            showNotification('Advertencia: El hash del archivo no coincide con el original', 'warning');
        }
        
        // Guardar en historial
        saveToHistory(metadata.n, metadata.t, blob.size, fileHash, totalBlocks - 1);
        
        showNotification(`Archivo reconstruido: ${metadata.n}`, 'success');
        
        // Reiniciar para nuevo escaneo
        resetScanner();
        
    } catch (error) {
        console.error('Error al reconstruir archivo:', error);
        showNotification('Error al reconstruir el archivo: ' + error.message, 'error');
    }
}

// Calcular hash SHA-256 de un blob
async function calculateFileHash(blob) {
    const buffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Guardar en historial
function saveToHistory(name, type, size, hash, blocks) {
    const history = getHistory();
    const newItem = {
        id: Date.now(),
        name,
        type,
        size,
        hash,
        blocks,
        date: new Date().toISOString()
    };
    
    history.unshift(newItem);
    // Mantener solo los últimos 10 elementos
    if (history.length > 10) {
        history.pop();
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
                    ${formatFileSize(item.size)} • ${new Date(item.date).toLocaleDateString()} • ${item.blocks} bloques
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
    
    const message = `
        Nombre: ${item.name}
        Tipo: ${item.type}
        Tamaño: ${formatFileSize(item.size)}
        Hash: ${item.hash}
        Bloques: ${item.blocks}
        Fecha: ${new Date(item.date).toLocaleString()}
    `;
    
    showNotification('Detalles del archivo:\n' + message, 'info', 8000);
}

// Limpiar historial
function clearHistory() {
    if (confirm('¿Estás seguro de que quieres borrar todo el historial?')) {
        localStorage.removeItem('shumzuHistory');
        loadHistory();
        showNotification('Historial borrado', 'info');
    }
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
    progressContainer.style.display = 'none';
    fileInfoSection.style.display = 'none';
    reconstructBtn.style.display = 'none';
    console.log('Escáner reiniciado, listo para nuevo escaneo');
}

// Inicializar cuando se carga la página
window.addEventListener('load', async () => {
    try {
        // jsQR ya se carga mediante CDN en el HTML
        if (typeof jsQR === 'undefined') {
            throw new Error('No se pudo cargar jsQR');
        }
        
        console.log('SHUMZU Web App inicializada correctamente');
        showNotification('SHUMZU está listo para escanear códigos QR', 'success', 3000);
    } catch (error) {
        console.error('Error al inicializar SHUMZU:', error);
        showNotification('Error al cargar las dependencias necesarias', 'error');
    }
});
