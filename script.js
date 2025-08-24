<!-- script.js -->
<script>
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

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    openCameraBtn.addEventListener('click', openCamera);
    closeModalBtn.addEventListener('click', closeCamera);
    fileInput.addEventListener('change', handleFileUpload);
});

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
    } catch (error) {
        console.error('Error al acceder a la cámara:', error);
        alert('No se pudo acceder a la cámara. Asegúrate de permitir el acceso.');
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
}

// Manejar subida de archivos (QR estáticos)
function handleFileUpload(event) {
    const files = event.target.files;
    if (!files.length) return;
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = e => processImageFile(e.target.result, file.name);
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
        }
    } catch (error) {
        console.error('Error al procesar imagen:', error);
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
                showNotification(`Archivo detectado: ${metadata.n} (${totalBlocks-1} bloques)`);
            } catch (e) {
                console.error('Error al procesar metadatos:', e);
                return;
            }
        }
        
        // Almacenar bloque
        if (!collectedBlocks.has(index)) {
            collectedBlocks.set(index, encodedData);
            console.log(`Bloque ${index} recibido de: ${source}`);
            updateProgress();
            
            // Verificar si tenemos todos los bloques
            if (collectedBlocks.size === totalBlocks && totalBlocks > 0) {
                showNotification('¡Todos los bloques recibidos! Reconstruyendo archivo...');
                setTimeout(reconstructFile, 1000);
            }
        }
    } catch (error) {
        console.error('Error al procesar datos QR:', error, data);
    }
}

// Actualizar barra de progreso
function updateProgress() {
    if (totalBlocks <= 0) return;
    
    const progress = Math.round((collectedBlocks.size / totalBlocks) * 100);
    console.log(`Progreso: ${progress}% (${collectedBlocks.size}/${totalBlocks} bloques)`);
    
    // Aquí podrías actualizar una barra de progreso visual en la UI
}

// Reconstruir archivo desde los bloques
async function reconstructFile() {
    if (!metadata || collectedBlocks.size < totalBlocks) {
        showNotification('Faltan bloques para reconstruir el archivo', 'error');
        return;
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
                throw new Error(`Falta el bloque ${i}`);
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
        
        showNotification(`Archivo reconstruido: ${metadata.n}`, 'success');
        
        // Reiniciar para nuevo escaneo
        resetScanner();
        
    } catch (error) {
        console.error('Error al reconstruir archivo:', error);
        showNotification('Error al reconstruir el archivo: ' + error.message, 'error');
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
function showNotification(message, type = 'info') {
    // Eliminar notificación anterior si existe
    const existingNotification = document.getElementById('shumzu-notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    // Crear nueva notificación
    const notification = document.createElement('div');
    notification.id = 'shumzu-notification';
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 5px;
        color: white;
        font-family: Arial, sans-serif;
        z-index: 10000;
        max-width: 300px;
        box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        transition: opacity 0.3s;
    `;
    
    // Estilo según tipo
    if (type === 'error') {
        notification.style.background = '#f44336';
    } else if (type === 'success') {
        notification.style.background = '#4CAF50';
    } else {
        notification.style.background = '#2196F3';
    }
    
    document.body.appendChild(notification);
    
    // Auto-eliminar después de 5 segundos
    setTimeout(() => {
        if (notification.parentNode) {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// Reiniciar escáner
function resetScanner() {
    collectedBlocks.clear();
    totalBlocks = 0;
    metadata = null;
    console.log('Escáner reiniciado, listo para nuevo escaneo');
}

// Cargar librería jsQR dinámicamente
function loadJSQR() {
    return new Promise((resolve, reject) => {
        if (typeof jsQR !== 'undefined') {
            resolve(jsQR);
            return;
        }
        
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
        script.onload = () => resolve(jsQR);
        script.onerror = () => reject(new Error('Error al cargar jsQR'));
        document.head.appendChild(script);
    });
}

// Inicializar cuando se carga la página
window.addEventListener('load', async () => {
    try {
        await loadJSQR();
        console.log('SHUMZU Web App inicializada correctamente');
    } catch (error) {
        console.error('Error al inicializar SHUMZU:', error);
        showNotification('Error al cargar las dependencias necesarias', 'error');
    }
});
</script>
