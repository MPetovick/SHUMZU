// script.js - Versión mejorada con escaneo ultrarrápido
const SCAN_CONFIG = {
    FPS_TARGET: 5,          // 5 FPS para balance entre velocidad y CPU
    SCAN_INTERVAL: 200,     // 200ms entre escaneos
    MAX_FRAME_SKIP: 2,      // Máximo frames a saltar
    DETECTION_THRESHOLD: 0.7, // Umbral de confianza
    AUTO_RECONSTRUCT: true,
    IGNORE_DUPLICATES: true,
    RESOLUTION: { width: 1280, height: 720 }
};

class UltraScanner {
    constructor() {
        this.stream = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.scanning = false;
        this.lastScanTime = 0;
        this.frameCount = 0;
        this.qrCount = 0;
        this.fps = 0;
        this.scanInterval = null;
        this.cameras = [];
        this.currentCamera = 'environment';
        this.torchEnabled = false;
        
        // Estadísticas en tiempo real
        this.stats = {
            totalScanned: 0,
            uniqueBlocks: 0,
            duplicates: 0,
            scanSpeed: 0,
            lastScanTimestamps: []
        };
        
        // Cache para QR detectados
        this.qrCache = new Set();
        
        // Compatibilidad con Python
        this.compat = new SHUMZUCompat();
    }
    
    async initialize() {
        try {
            // Obtener lista de cámaras
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(device => device.kind === 'videoinput');
            
            // Iniciar con cámara trasera por defecto
            await this.startCamera('environment');
            return true;
        } catch (error) {
            console.error('Error inicializando escáner:', error);
            return false;
        }
    }
    
    async startCamera(facingMode = 'environment') {
        try {
            if (this.stream) {
                this.stopCamera();
            }
            
            const constraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: SCAN_CONFIG.RESOLUTION.width },
                    height: { ideal: SCAN_CONFIG.RESOLUTION.height },
                    frameRate: { ideal: 30 }
                },
                audio: false
            };
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            this.currentCamera = facingMode;
            return this.stream;
        } catch (error) {
            console.error('Error accediendo a la cámara:', error);
            throw error;
        }
    }
    
    async switchCamera() {
        try {
            const newMode = this.currentCamera === 'environment' ? 'user' : 'environment';
            await this.startCamera(newMode);
            return newMode;
        } catch (error) {
            console.error('Error cambiando cámara:', error);
            return this.currentCamera;
        }
    }
    
    async toggleTorch() {
        try {
            const track = this.stream?.getVideoTracks()[0];
            if (track && 'applyConstraints' in track) {
                this.torchEnabled = !this.torchEnabled;
                await track.applyConstraints({
                    advanced: [{ torch: this.torchEnabled }]
                });
            }
            return this.torchEnabled;
        } catch (error) {
            console.warn('Linterna no soportada:', error);
            return false;
        }
    }
    
    startScanning(videoElement, callback) {
        if (!this.stream || this.scanning) return;
        
        this.scanning = true;
        this.frameCount = 0;
        this.lastScanTime = Date.now();
        this.stats.lastScanTimestamps = [];
        
        // Configurar canvas
        this.canvas.width = SCAN_CONFIG.RESOLUTION.width;
        this.canvas.height = SCAN_CONFIG.RESOLUTION.height;
        
        // Iniciar bucle de escaneo
        this.scanInterval = setInterval(() => {
            this.processFrame(videoElement, callback);
        }, SCAN_CONFIG.SCAN_INTERVAL);
        
        // Actualizar FPS cada segundo
        setInterval(() => {
            const now = Date.now();
            const elapsed = (now - this.lastScanTime) / 1000;
            this.fps = elapsed > 0 ? this.frameCount / elapsed : 0;
            this.frameCount = 0;
            this.lastScanTime = now;
        }, 1000);
    }
    
    processFrame(video, callback) {
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
            return;
        }
        
        try {
            // Dibujar frame en canvas
            this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
            this.frameCount++;
            
            // Obtener datos de imagen
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            
            // Escanear QR
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
            });
            
            if (code) {
                this.handleQRCode(code.data, callback);
            }
            
            // Actualizar estadísticas
            this.updateStats();
            
        } catch (error) {
            console.error('Error procesando frame:', error);
        }
    }
    
    handleQRCode(data, callback) {
        this.stats.totalScanned++;
        
        try {
            // Detectar formato
            const format = detectSHUMZUFormat(data);
            
            if (format === 'python') {
                // Procesar QR de Python
                const result = this.compat.decodePythonQR(data);
                
                if (result) {
                    const isNew = !this.qrCache.has(data);
                    
                    if (isNew || !SCAN_CONFIG.IGNORE_DUPLICATES) {
                        this.stats.uniqueBlocks = this.compat.qrData.size;
                        
                        if (isNew) {
                            this.qrCache.add(data);
                            callback({
                                data: data,
                                format: 'python',
                                isNew: true,
                                metadata: result.metadata,
                                progress: this.compat.getProgress()
                            });
                        } else {
                            this.stats.duplicates++;
                            callback({
                                data: data,
                                format: 'python',
                                isNew: false,
                                isDuplicate: true
                            });
                        }
                    }
                }
            } else if (format === 'web') {
                // Procesar QR Web (existente)
                callback({
                    data: data,
                    format: 'web',
                    isNew: true
                });
            }
            
        } catch (error) {
            console.error('Error procesando QR:', error);
            callback({
                data: data,
                format: 'invalid',
                error: error.message
            });
        }
    }
    
    updateStats() {
        const now = Date.now();
        this.stats.lastScanTimestamps.push(now);
        
        // Mantener solo últimos 10 segundos
        const tenSecondsAgo = now - 10000;
        this.stats.lastScanTimestamps = this.stats.lastScanTimestamps.filter(t => t > tenSecondsAgo);
        
        // Calcular velocidad (QR/seg)
        if (this.stats.lastScanTimestamps.length > 1) {
            const timeSpan = (this.stats.lastScanTimestamps[this.stats.lastScanTimestamps.length - 1] - 
                           this.stats.lastScanTimestamps[0]) / 1000;
            this.stats.scanSpeed = timeSpan > 0 ? 
                (this.stats.lastScanTimestamps.length / timeSpan).toFixed(1) : 0;
        }
    }
    
    pause() {
        if (this.scanInterval) {
            clearInterval(this.scanInterval);
            this.scanInterval = null;
            this.scanning = false;
        }
    }
    
    resume() {
        if (!this.scanning && this.stream) {
            this.scanning = true;
            // El intervalo se reinicia desde fuera
        }
    }
    
    stopCamera() {
        this.pause();
        
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        
        this.scanning = false;
        this.torchEnabled = false;
    }
    
    getStats() {
        return {
            ...this.stats,
            fps: this.fps.toFixed(1),
            progress: this.compat.getProgress(),
            totalBlocks: this.compat.totalBlocks,
            receivedBlocks: this.compat.qrData.size,
            format: this.compat.metadata ? 'python' : 'unknown'
        };
    }
    
    async saveProgress() {
        const progress = {
            timestamp: Date.now(),
            metadata: this.compat.metadata,
            qrData: Array.from(this.compat.qrData.entries()),
            stats: this.getStats()
        };
        
        localStorage.setItem('shumzu_scan_progress', JSON.stringify(progress));
        return progress;
    }
    
    async loadProgress() {
        const saved = localStorage.getItem('shumzu_scan_progress');
        if (saved) {
            const progress = JSON.parse(saved);
            
            // Restaurar datos
            this.compat.metadata = progress.metadata;
            this.compat.qrData = new Map(progress.qrData);
            this.compat.totalBlocks = progress.metadata?.b || 0;
            this.compat.isEncrypted = progress.metadata?.e === 1;
            this.compat.isCompressed = progress.metadata?.c === 1;
            
            // Restaurar cache
            this.qrCache = new Set(progress.qrData.map(([_, data]) => data));
            
            return progress;
        }
        return null;
    }
    
    reset() {
        this.compat.reset();
        this.qrCache.clear();
        this.stats = {
            totalScanned: 0,
            uniqueBlocks: 0,
            duplicates: 0,
            scanSpeed: 0,
            lastScanTimestamps: []
        };
    }
}

// Aplicación principal
class SHUMZUApp {
    constructor() {
        this.scanner = new UltraScanner();
        this.currentMode = 'scan';
        this.reconstructionInProgress = false;
        this.filePassword = null;
        
        // Elementos DOM
        this.elements = {
            cameraModal: document.getElementById('camera-modal'),
            cameraStream: document.getElementById('camera-stream'),
            scanOverlay: document.getElementById('scan-overlay'),
            scanFeedback: document.getElementById('scan-feedback'),
            totalScanned: document.getElementById('total-scanned'),
            uniqueBlocks: document.getElementById('unique-blocks'),
            scanSpeed: document.getElementById('scan-speed'),
            scanResolution: document.getElementById('scan-resolution'),
            
            // Progreso
            scanProgressContainer: document.getElementById('scan-progress-container'),
            scanProgressPercent: document.getElementById('scan-progress-percent'),
            scanProgressFill: document.getElementById('scan-progress-fill'),
            scannedFrames: document.getElementById('scanned-frames'),
            detectedQrs: document.getElementById('detected-qrs'),
            scanFps: document.getElementById('scan-fps'),
            
            // Reconstrucción
            reconProgressContainer: document.getElementById('reconstruction-progress-container'),
            reconProgressFill: document.getElementById('reconstruction-progress-fill'),
            blocksInfo: document.getElementById('blocks-info'),
            dataSize: document.getElementById('data-size'),
            blockGrid: document.getElementById('block-grid'),
            compatibilityStatus: document.getElementById('compatibility-status'),
            
            // Información de archivo
            fileInfo: document.getElementById('file-info'),
            infoName: document.getElementById('info-name'),
            infoSize: document.getElementById('info-size'),
            infoBlocks: document.getElementById('info-blocks'),
            infoEncryption: document.getElementById('info-encryption'),
            infoDate: document.getElementById('info-date'),
            infoHash: document.getElementById('info-hash'),
            reconstructBtn: document.getElementById('reconstruct-btn'),
            
            // Modales
            passwordModal: document.getElementById('password-modal'),
            passwordInput: document.getElementById('password-input'),
            metadataModal: document.getElementById('metadata-modal'),
            metadataContent: document.getElementById('metadata-content')
        };
        
        // Configuración
        this.config = {
            autoReconstruct: true,
            ignoreDuplicates: true,
            showFeedback: true,
            saveProgress: true
        };
        
        this.initialize();
    }
    
    async initialize() {
        // Cargar configuración
        this.loadConfig();
        
        // Inicializar escáner
        await this.scanner.initialize();
        
        // Cargar progreso anterior
        const saved = await this.scanner.loadProgress();
        if (saved) {
            this.showNotification('Progreso anterior cargado', 'info');
            this.updateUIFromProgress();
        }
        
        // Configurar eventos
        this.setupEventListeners();
        
        // Actualizar UI inicial
        this.updateUI();
        
        console.log('SHUMZU+ App inicializada');
    }
    
    setupEventListeners() {
        // Modo
        document.getElementById('mode-scan').addEventListener('click', () => this.switchMode('scan'));
        document.getElementById('mode-generate').addEventListener('click', () => this.switchMode('generate'));
        
        // Cámara
        document.getElementById('open-camera').addEventListener('click', () => this.openCamera());
        document.getElementById('close-modal').addEventListener('click', () => this.closeCamera());
        document.getElementById('switch-camera').addEventListener('click', () => this.switchCamera());
        document.getElementById('toggle-torch').addEventListener('click', () => this.toggleTorch());
        document.getElementById('pause-scan').addEventListener('click', () => this.pauseScan());
        document.getElementById('resume-scan').addEventListener('click', () => this.resumeScan());
        document.getElementById('save-scan').addEventListener('click', () => this.saveScanProgress());
        
        // Subida de archivos
        document.getElementById('upload-files').addEventListener('click', () => {
            document.getElementById('file-input').click();
        });
        document.getElementById('file-input').addEventListener('change', (e) => this.handleFileUpload(e));
        
        // Reconstrucción
        document.getElementById('reconstruct-btn').addEventListener('click', () => this.startReconstruction());
        document.getElementById('cancel-reconstruction').addEventListener('click', () => this.cancelReconstruction());
        
        // Contraseña
        document.getElementById('confirm-password').addEventListener('click', () => this.confirmPassword());
        document.getElementById('cancel-password').addEventListener('click', () => this.closePasswordModal());
        document.getElementById('toggle-password').addEventListener('click', () => this.togglePasswordVisibility());
        
        // Metadatos
        document.getElementById('show-metadata').addEventListener('click', () => this.showMetadata());
        document.getElementById('close-metadata-modal').addEventListener('click', () => this.closeMetadataModal());
        
        // Configuración
        document.getElementById('auto-reconstruct').addEventListener('change', (e) => {
            this.config.autoReconstruct = e.target.checked;
            this.saveConfig();
        });
        document.getElementById('ignore-duplicates').addEventListener('change', (e) => {
            this.config.ignoreDuplicates = e.target.checked;
            SCAN_CONFIG.IGNORE_DUPLICATES = e.target.checked;
            this.saveConfig();
        });
        
        // Tema
        document.getElementById('theme-toggle').addEventListener('click', () => this.toggleTheme());
        
        // Teclas rápidas
        document.addEventListener('keydown', (e) => this.handleKeydown(e));
    }
    
    async openCamera() {
        try {
            this.elements.cameraModal.style.display = 'flex';
            
            // Iniciar cámara si no está activa
            if (!this.scanner.stream) {
                await this.scanner.startCamera();
            }
            
            // Conectar stream al video
            this.elements.cameraStream.srcObject = this.scanner.stream;
            
            // Iniciar escaneo
            this.scanner.startScanning(this.elements.cameraStream, (result) => {
                this.handleScanResult(result);
            });
            
            // Actualizar UI de cámara
            this.updateCameraUI();
            
        } catch (error) {
            console.error('Error abriendo cámara:', error);
            this.showNotification('Error al acceder a la cámara', 'error');
        }
    }
    
    handleScanResult(result) {
        // Actualizar estadísticas
        const stats = this.scanner.getStats();
        this.elements.totalScanned.textContent = stats.totalScanned;
        this.elements.uniqueBlocks.textContent = stats.uniqueBlocks;
        this.elements.scanSpeed.textContent = stats.scanSpeed;
        
        // Mostrar feedback visual
        if (result.isNew) {
            this.showScanFeedback('✓ QR detectado', 'success');
            
            // Actualizar progreso
            this.updateScanProgress(stats.progress);
            
            // Mostrar información si hay metadatos
            if (result.metadata) {
                this.displayFileInfo(result.metadata);
            }
            
            // Reconstruir automáticamente si está configurado
            if (this.config.autoReconstruct && stats.progress >= 100) {
                this.startReconstruction();
            }
        } else if (result.isDuplicate) {
            this.showScanFeedback('⚠️ QR duplicado', 'warning');
        }
        
        // Actualizar UI
        this.updateUI();
    }
    
    updateScanProgress(progress) {
        this.elements.scanProgressContainer.style.display = 'block';
        this.elements.scanProgressPercent.textContent = `${progress}%`;
        this.elements.scanProgressFill.style.width = `${progress}%`;
        
        const stats = this.scanner.getStats();
        this.elements.scannedFrames.textContent = stats.frameCount || 0;
        this.elements.detectedQrs.textContent = stats.totalScanned;
        this.elements.scanFps.textContent = stats.fps;
    }
    
    displayFileInfo(metadata) {
        this.elements.fileInfo.style.display = 'block';
        
        this.elements.infoName.textContent = metadata.n || 'Desconocido';
        this.elements.infoSize.textContent = this.formatSize(metadata.s || 0);
        this.elements.infoBlocks.textContent = `${metadata.b || 0} bloques`;
        this.elements.infoEncryption.textContent = metadata.e === 1 ? '🔒 Cifrado' : '🔓 No cifrado';
        this.elements.infoDate.textContent = metadata.t ? 
            new Date(metadata.t * 1000).toLocaleDateString() : 'Desconocido';
        this.elements.infoHash.textContent = metadata.h ? metadata.h.substring(0, 32) + '...' : 'No disponible';
        
        // Mostrar botón de reconstruir si tenemos bloques
        if (this.scanner.compat.qrData.size > 0) {
            this.elements.reconstructBtn.style.display = 'block';
        }
        
        // Actualizar estado de compatibilidad
        this.elements.compatibilityStatus.textContent = 'SHUMZU Python';
        this.elements.compatibilityStatus.className = 'stat-value compatible';
    }
    
    async startReconstruction() {
        if (this.reconstructionInProgress) return;
        
        try {
            this.reconstructionInProgress = true;
            this.elements.reconProgressContainer.style.display = 'block';
            
            // Verificar si necesita contraseña
            if (this.scanner.compat.isEncrypted) {
                this.openPasswordModal();
                return;
            }
            
            // Iniciar reconstrucción
            await this.reconstructFile();
            
        } catch (error) {
            console.error('Error iniciando reconstrucción:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
            this.reconstructionInProgress = false;
        }
    }
    
    async reconstructFile(password = '') {
        try {
            this.showNotification('Reconstruyendo archivo...', 'info');
            
            // Actualizar UI
            this.updateReconstructionUI(0, 'Preparando...');
            
            // Reconstruir archivo
            const result = await this.scanner.compat.reconstructFile(password);
            
            // Actualizar UI durante reconstrucción
            this.updateReconstructionUI(50, 'Procesando datos...');
            
            if (result.hashMatches) {
                this.showNotification('✅ Archivo reconstruido exitosamente', 'success');
                
                // Crear y descargar archivo
                const blob = new Blob([result.data]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.metadata.n;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                // Guardar en historial
                this.saveToHistory(result);
                
                // Actualizar UI final
                this.updateReconstructionUI(100, 'Completado');
                setTimeout(() => {
                    this.elements.reconProgressContainer.style.display = 'none';
                }, 2000);
                
            } else {
                this.showNotification('⚠️ Hash no coincide - archivo puede estar corrupto', 'warning');
            }
            
        } catch (error) {
            console.error('Error reconstruyendo archivo:', error);
            this.showNotification(`Error: ${error.message}`, 'error');
        } finally {
            this.reconstructionInProgress = false;
        }
    }
    
    updateReconstructionUI(progress, status) {
        this.elements.reconProgressFill.style.width = `${progress}%`;
        
        const stats = this.scanner.getStats();
        this.elements.blocksInfo.textContent = 
            `${stats.receivedBlocks}/${stats.totalBlocks} bloques`;
        
        if (this.scanner.compat.metadata) {
            this.elements.dataSize.textContent = 
                this.formatSize(this.scanner.compat.metadata.s);
        }
        
        // Actualizar grid de bloques
        this.updateBlockGrid();
    }
    
    updateBlockGrid() {
        const grid = this.elements.blockGrid;
        grid.innerHTML = '';
        
        const total = this.scanner.compat.totalBlocks;
        const received = this.scanner.compat.qrData.size;
        
        // Crear indicadores de bloque
        for (let i = 1; i <= total; i++) {
            const block = document.createElement('div');
            block.className = 'block-indicator';
            block.title = `Bloque ${i}`;
            
            if (this.scanner.compat.qrData.has(i)) {
                block.classList.add('received');
                block.textContent = i;
            } else {
                block.classList.add('missing');
                block.textContent = '?';
            }
            
            grid.appendChild(block);
        }
    }
    
    async handleFileUpload(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        
        this.showNotification(`Procesando ${files.length} archivo(s)...`, 'info');
        
        for (const file of files) {
            await this.processUploadedFile(file);
        }
        
        this.showNotification('Archivos procesados', 'success');
    }
    
    async processUploadedFile(file) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    if (file.type.startsWith('image/')) {
                        await this.processImageFile(e.target.result, file.name);
                    } else if (file.type.startsWith('video/') || file.name.endsWith('.gif')) {
                        await this.processVideoFile(e.target.result, file.name);
                    }
                } catch (error) {
                    console.error(`Error procesando ${file.name}:`, error);
                }
                resolve();
            };
            
            reader.onerror = () => {
                console.error(`Error leyendo ${file.name}`);
                resolve();
            };
            
            if (file.type.startsWith('video/') || file.name.endsWith('.gif')) {
                reader.readAsArrayBuffer(file);
            } else {
                reader.readAsDataURL(file);
            }
        });
    }
    
    async processImageFile(dataUrl, filename) {
        const img = new Image();
        img.src = dataUrl;
        
        await new Promise((resolve) => {
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                
                if (code) {
                    this.handleScanResult({
                        data: code.data,
                        isNew: true,
                        format: detectSHUMZUFormat(code.data)
                    });
                }
                
                resolve();
            };
        });
    }
    
    // Métodos auxiliares
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(2)} ${units[unitIndex]}`;
    }
    
    showNotification(message, type = 'info', duration = 3000) {
        // Implementación de notificación (similar a versión anterior)
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
    
    showScanFeedback(message, type) {
        const feedback = this.elements.scanFeedback;
        feedback.textContent = message;
        feedback.className = `scan-feedback ${type}`;
        feedback.style.display = 'block';
        
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 1000);
    }
    
    // Gestión de modales
    openPasswordModal() {
        this.elements.passwordModal.style.display = 'flex';
        this.elements.passwordInput.focus();
    }
    
    closePasswordModal() {
        this.elements.passwordModal.style.display = 'none';
        this.elements.passwordInput.value = '';
    }
    
    async confirmPassword() {
        const password = this.elements.passwordInput.value;
        if (!password) {
            this.showNotification('Ingresa una contraseña', 'warning');
            return;
        }
        
        this.closePasswordModal();
        await this.reconstructFile(password);
    }
    
    togglePasswordVisibility() {
        const input = this.elements.passwordInput;
        input.type = input.type === 'password' ? 'text' : 'password';
    }
    
    showMetadata() {
        if (!this.scanner.compat.metadata) return;
        
        const metadata = this.scanner.compat.metadata;
        let content = '<div class="metadata-grid">';
        
        for (const [key, value] of Object.entries(metadata)) {
            content += `
                <div class="metadata-item">
                    <strong>${key}:</strong>
                    <span>${typeof value === 'object' ? JSON.stringify(value) : value}</span>
                </div>
            `;
        }
        
        content += '</div>';
        this.elements.metadataContent.innerHTML = content;
        this.elements.metadataModal.style.display = 'flex';
    }
    
    closeMetadataModal() {
        this.elements.metadataModal.style.display = 'none';
    }
    
    // Control de cámara
    async switchCamera() {
        const newMode = await this.scanner.switchCamera();
        this.elements.cameraStream.srcObject = this.scanner.stream;
        this.showNotification(`Cámara cambiada a ${newMode === 'environment' ? 'trasera' : 'frontal'}`, 'info');
    }
    
    async toggleTorch() {
        const enabled = await this.scanner.toggleTorch();
        this.showNotification(`Linterna ${enabled ? 'activada' : 'desactivada'}`, 'info');
    }
    
    pauseScan() {
        this.scanner.pause();
        document.getElementById('pause-scan').style.display = 'none';
        document.getElementById('resume-scan').style.display = 'inline-block';
        this.showNotification('Escaneo pausado', 'info');
    }
    
    resumeScan() {
        this.scanner.resume();
        document.getElementById('pause-scan').style.display = 'inline-block';
        document.getElementById('resume-scan').style.display = 'none';
        this.showNotification('Escaneo reanudado', 'info');
    }
    
    async saveScanProgress() {
        await this.scanner.saveProgress();
        this.showNotification('Progreso guardado', 'success');
    }
    
    // Modos de la aplicación
    switchMode(mode) {
        this.currentMode = mode;
        
        // Actualizar botones de modo
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`mode-${mode}`).classList.add('active');
        
        // Mostrar/ocultar secciones
        document.querySelectorAll('.active-section').forEach(section => {
            section.classList.remove('active-section');
        });
        document.getElementById(`${mode}-section`).classList.add('active-section');
    }
    
    // Configuración
    loadConfig() {
        const saved = localStorage.getItem('shumzu_config');
        if (saved) {
            this.config = { ...this.config, ...JSON.parse(saved) };
        }
        
        // Aplicar a UI
        document.getElementById('auto-reconstruct').checked = this.config.autoReconstruct;
        document.getElementById('ignore-duplicates').checked = this.config.ignoreDuplicates;
    }
    
    saveConfig() {
        localStorage.setItem('shumzu_config', JSON.stringify(this.config));
    }
    
    // Tema
    toggleTheme() {
        const current = document.body.getAttribute('data-theme') || 'light';
        const newTheme = current === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('shumzu_theme', newTheme);
        
        const toggle = document.getElementById('theme-toggle');
        toggle.textContent = newTheme === 'light' ? '🌙' : '☀️';
    }
    
    // Teclas rápidas
    handleKeydown(e) {
        if (e.key === 'Escape') {
            this.closeCamera();
            this.closePasswordModal();
            this.closeMetadataModal();
        }
        
        if (e.key === 'Enter' && this.elements.passwordModal.style.display === 'flex') {
            this.confirmPassword();
        }
        
        // Atajos de cámara
        if (e.key === ' ' && this.scanner.scanning) {
            e.preventDefault();
            this.pauseScan();
        }
        
        if (e.key === 's' && e.ctrlKey) {
            e.preventDefault();
            this.saveScanProgress();
        }
    }
    
    closeCamera() {
        this.scanner.stopCamera();
        this.elements.cameraModal.style.display = 'none';
    }
    
    cancelReconstruction() {
        this.reconstructionInProgress = false;
        this.elements.reconProgressContainer.style.display = 'none';
        this.showNotification('Reconstrucción cancelada', 'info');
    }
    
    updateUI() {
        // Actualizar estadísticas en tiempo real
        const stats = this.scanner.getStats();
        
        if (stats.totalBlocks > 0) {
            const progress = Math.round((stats.receivedBlocks / stats.totalBlocks) * 100);
            this.elements.scanProgressPercent.textContent = `${progress}%`;
            this.elements.scanProgressFill.style.width = `${progress}%`;
        }
    }
    
    updateUIFromProgress() {
        const stats = this.scanner.getStats();
        
        if (this.scanner.compat.metadata) {
            this.displayFileInfo(this.scanner.compat.metadata);
        }
        
        if (stats.receivedBlocks > 0) {
            this.updateScanProgress(stats.progress);
            this.updateBlockGrid();
        }
    }
    
    saveToHistory(result) {
        // Implementación similar a versión anterior
        console.log('Guardando en historial:', result);
    }
}

// Inicializar aplicación cuando se cargue la página
document.addEventListener('DOMContentLoaded', () => {
    // Cargar tema
    const savedTheme = localStorage.getItem('shumzu_theme') || 'light';
    document.body.setAttribute('data-theme', savedTheme);
    
    // Inicializar app
    window.SHUMZU_APP = new SHUMZUApp();
});
