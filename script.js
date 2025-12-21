// script.js - Versión optimizada y refactorizada
class SHUMZUApp {
    constructor() {
        this.config = {
            autoReconstruct: true,
            ignoreDuplicates: true,
            maxFileSize: 50 * 1024 * 1024, // 50MB
            cameraFPS: 5,
            scanResolution: { width: 640, height: 480 }
        };
        
        this.state = {
            currentMode: 'scan',
            scanning: false,
            reconstructing: false,
            generating: false,
            selectedFile: null,
            qrCodes: [],
            scanProgress: 0,
            generationProgress: 0
        };
        
        this.scanner = new QRScanner(this);
        this.generator = new QRGenerator(this);
        this.ui = new UIManager(this);
        
        this.initialize();
    }
    
    async initialize() {
        this.ui.setupEventListeners();
        await this.scanner.initialize();
        this.loadSavedSettings();
        this.ui.updateTheme();
        
        console.log('SHUMZU+ inicializado');
    }
    
    loadSavedSettings() {
        const saved = localStorage.getItem('shumzu_config');
        if (saved) {
            this.config = { ...this.config, ...JSON.parse(saved) };
        }
    }
    
    saveSettings() {
        localStorage.setItem('shumzu_config', JSON.stringify(this.config));
    }
    
    switchMode(mode) {
        this.state.currentMode = mode;
        this.ui.updateMode(mode);
    }
    
    showNotification(message, type = 'info', duration = 3000) {
        this.ui.showNotification(message, type, duration);
    }
    
    formatSize(bytes) {
        const units = ['B', 'KB', 'MB', 'GB'];
        let size = bytes;
        let unitIndex = 0;
        
        while (size >= 1024 && unitIndex < units.length - 1) {
            size /= 1024;
            unitIndex++;
        }
        
        return `${size.toFixed(1)} ${units[unitIndex]}`;
    }
}

class QRScanner {
    constructor(app) {
        this.app = app;
        this.stream = null;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d');
        this.scanning = false;
        this.lastFrameTime = 0;
        this.frameCount = 0;
        this.fps = 0;
        this.animationFrame = null;
        this.qrCache = new Set();
        this.compat = new SHUMZUCompat();
        
        // Configurar canvas con la resolución deseada
        this.canvas.width = this.app.config.scanResolution.width;
        this.canvas.height = this.app.config.scanResolution.height;
    }
    
    async initialize() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.cameras = devices.filter(d => d.kind === 'videoinput');
            return true;
        } catch (error) {
            console.error('Error inicializando escáner:', error);
            return false;
        }
    }
    
    async startCamera(facingMode = 'environment') {
        try {
            if (this.stream) this.stopCamera();
            
            const constraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: this.app.config.scanResolution.width },
                    height: { ideal: this.app.config.scanResolution.height },
                    frameRate: { ideal: this.app.config.cameraFPS * 2 }
                },
                audio: false
            };
            
            this.stream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Mostrar modal de cámara
            this.app.ui.showCameraModal();
            
            const videoElement = document.getElementById('camera-stream');
            videoElement.srcObject = this.stream;
            
            return this.stream;
        } catch (error) {
            this.app.showNotification('Error accediendo a la cámara', 'error');
            throw error;
        }
    }
    
    startScanning(videoElement) {
        if (!this.stream || this.scanning) return;
        
        this.scanning = true;
        this.frameCount = 0;
        this.lastFrameTime = performance.now();
        
        const processFrame = (timestamp) => {
            if (!this.scanning) return;
            
            // Control de FPS
            const elapsed = timestamp - this.lastFrameTime;
            const targetInterval = 1000 / this.app.config.cameraFPS;
            
            if (elapsed >= targetInterval) {
                this.processFrame(videoElement);
                this.lastFrameTime = timestamp - (elapsed % targetInterval);
            }
            
            this.animationFrame = requestAnimationFrame(processFrame);
        };
        
        this.animationFrame = requestAnimationFrame(processFrame);
        
        // Calcular FPS cada segundo
        this.fpsInterval = setInterval(() => {
            const now = performance.now();
            const elapsed = (now - this.lastFrameTime) / 1000;
            this.fps = elapsed > 0 ? this.frameCount / elapsed : 0;
            this.frameCount = 0;
            this.updateStats();
        }, 1000);
    }
    
    processFrame(video) {
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return;
        
        try {
            this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
            this.frameCount++;
            
            const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
                inversionAttempts: 'dontInvert',
            });
            
            if (code) {
                this.handleQRCode(code.data);
            }
        } catch (error) {
            console.warn('Error procesando frame:', error);
        }
    }
    
    handleQRCode(data) {
        if (this.qrCache.has(data) && this.app.config.ignoreDuplicates) {
            this.app.ui.showScanFeedback('Duplicado', 'warning');
            return;
        }
        
        this.qrCache.add(data);
        
        try {
            const format = detectSHUMZUFormat(data);
            
            if (format === 'python') {
                const result = this.compat.decodePythonQR(data);
                if (result) {
                    this.app.ui.showScanFeedback('QR detectado ✓', 'success');
                    this.app.ui.updateScanProgress(this.compat.getProgress());
                    
                    if (result.metadata) {
                        this.app.ui.displayFileInfo(result.metadata);
                    }
                    
                    if (this.app.config.autoReconstruct && this.compat.getProgress() === 100) {
                        this.startReconstruction();
                    }
                }
            }
        } catch (error) {
            console.error('Error procesando QR:', error);
        }
        
        this.updateStats();
    }
    
    async startReconstruction() {
        if (this.compat.isEncrypted) {
            // Pedir contraseña
            this.app.ui.showPasswordModal().then(password => {
                if (password) {
                    this.reconstructFile(password);
                }
            });
        } else {
            this.reconstructFile();
        }
    }
    
    async reconstructFile(password = '') {
        try {
            this.app.showNotification('Reconstruyendo archivo...', 'info');
            const result = await this.compat.reconstructFile(password);
            
            if (result.hashMatches) {
                this.app.showNotification('✅ Archivo reconstruido exitosamente', 'success');
                
                // Descargar archivo
                const blob = new Blob([result.data]);
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = result.metadata.n;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else {
                this.app.showNotification('⚠️ Hash no coincide - archivo puede estar corrupto', 'warning');
            }
        } catch (error) {
            this.app.showNotification(`Error reconstruyendo: ${error.message}`, 'error');
        }
    }
    
    updateStats() {
        const stats = {
            fps: this.fps.toFixed(1),
            totalScanned: this.qrCache.size,
            progress: this.compat.getProgress(),
            uniqueBlocks: this.compat.qrData.size
        };
        
        this.app.ui.updateScannerStats(stats);
    }
    
    pause() {
        this.scanning = false;
        if (this.animationFrame) {
            cancelAnimationFrame(this.animationFrame);
            this.animationFrame = null;
        }
        if (this.fpsInterval) {
            clearInterval(this.fpsInterval);
            this.fpsInterval = null;
        }
    }
    
    stopCamera() {
        this.pause();
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.stream = null;
        }
        this.app.ui.hideCameraModal();
    }
}

class QRGenerator {
    constructor(app) {
        this.app = app;
        this.file = null;
        this.qrCodes = [];
        this.metadata = null;
        this.options = {
            quality: 'M',
            blockSize: 1024,
            encryption: false,
            password: '',
            compression: true
        };
    }
    
    async processFile(file) {
        if (!file) throw new Error('No se seleccionó archivo');
        
        if (file.size > this.app.config.maxFileSize) {
            throw new Error(`Archivo demasiado grande (máx: ${this.app.formatSize(this.app.config.maxFileSize)})`);
        }
        
        this.file = file;
        this.app.ui.showSelectedFile(file);
        
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            
            reader.onload = async (e) => {
                try {
                    const fileData = new Uint8Array(e.target.result);
                    
                    // Calcular hash
                    const hashBuffer = await crypto.subtle.digest('SHA-256', fileData);
                    const hash = Array.from(new Uint8Array(hashBuffer))
                        .map(b => b.toString(16).padStart(2, '0'))
                        .join('');
                    
                    this.metadata = {
                        n: file.name,
                        s: fileData.length,
                        h: hash,
                        e: this.options.encryption ? 1 : 0,
                        c: this.options.compression ? 1 : 0,
                        t: Math.floor(Date.now() / 1000),
                        bs: this.options.blockSize,
                        tb: 0
                    };
                    
                    resolve(fileData);
                } catch (error) {
                    reject(error);
                }
            };
            
            reader.onerror = () => reject(new Error('Error leyendo archivo'));
            reader.readAsArrayBuffer(file);
        });
    }
    
    async generateQRs(fileData) {
        this.app.state.generating = true;
        this.app.state.generationProgress = 0;
        this.app.ui.showGenerationProgress(true);
        
        try {
            // Comprimir datos si está habilitado
            let processedData = fileData;
            if (this.options.compression) {
                this.app.ui.updateGenerationStatus('Comprimiendo datos...');
                processedData = pako.deflate(fileData);
            }
            
            // Cifrar datos si está habilitado
            if (this.options.encryption && this.options.password) {
                this.app.ui.updateGenerationStatus('Cifrando datos...');
                processedData = await this.encryptData(processedData, this.options.password);
            }
            
            // Dividir en bloques
            const totalBlocks = Math.ceil(processedData.length / this.options.blockSize);
            this.metadata.tb = totalBlocks + 1; // +1 para metadata
            
            // Generar QR de metadata (bloque 0)
            const metadataBlock = {
                i: 0,
                m: this.metadata,
                d: processedData.length > 0 ? 
                    this.arrayToBase64(processedData.slice(0, Math.min(this.options.blockSize, processedData.length))) : 
                    null
            };
            
            this.app.ui.updateGenerationProgress(10);
            await this.generateQRBlock(metadataBlock, 0);
            
            // Generar QR para cada bloque de datos
            for (let i = 1; i <= totalBlocks; i++) {
                if (!this.app.state.generating) break; // Permitir cancelación
                
                const start = (i - 1) * this.options.blockSize;
                const end = Math.min(start + this.options.blockSize, processedData.length);
                const blockData = processedData.slice(start, end);
                
                const block = {
                    i: i,
                    d: this.arrayToBase64(blockData)
                };
                
                const progress = 10 + (i / totalBlocks * 90);
                this.app.ui.updateGenerationProgress(progress);
                this.app.ui.updateGenerationStatus(`Generando bloque ${i}/${totalBlocks}`);
                
                await this.generateQRBlock(block, i);
                
                // Pequeña pausa para no bloquear el UI
                await new Promise(resolve => setTimeout(resolve, 10));
            }
            
            if (this.app.state.generating) {
                this.app.showNotification(`${totalBlocks + 1} códigos QR generados`, 'success');
                this.app.ui.enableDownload();
            }
            
        } catch (error) {
            throw error;
        } finally {
            this.app.state.generating = false;
            this.app.ui.showGenerationProgress(false);
        }
    }
    
    async generateQRBlock(data, index) {
        return new Promise((resolve) => {
            const qrData = JSON.stringify(data);
            const qrItem = {
                index: index,
                data: qrData,
                type: index === 0 ? 'metadata' : 'data'
            };
            
            this.qrCodes.push(qrItem);
            this.app.ui.addQRToGallery(qrItem, index);
            
            resolve();
        });
    }
    
    async encryptData(data, password) {
        // Implementación básica de cifrado
        const encoder = new TextEncoder();
        const passwordBuffer = encoder.encode(password);
        
        const key = await crypto.subtle.importKey(
            'raw',
            passwordBuffer,
            { name: 'PBKDF2' },
            false,
            ['deriveKey']
        );
        
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const derivedKey = await crypto.subtle.deriveKey(
            {
                name: 'PBKDF2',
                salt: salt,
                iterations: 100000,
                hash: 'SHA-256'
            },
            key,
            { name: 'AES-GCM', length: 256 },
            false,
            ['encrypt']
        );
        
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const encrypted = await crypto.subtle.encrypt(
            {
                name: 'AES-GCM',
                iv: iv
            },
            derivedKey,
            data
        );
        
        // Combinar salt + iv + datos cifrados
        const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
        result.set(salt);
        result.set(iv, salt.length);
        result.set(new Uint8Array(encrypted), salt.length + iv.length);
        
        return result;
    }
    
    arrayToBase64(array) {
        return btoa(String.fromCharCode(...array));
    }
    
    reset() {
        this.file = null;
        this.qrCodes = [];
        this.metadata = null;
        this.app.ui.resetGenerationUI();
    }
}

class UIManager {
    constructor(app) {
        this.app = app;
        this.elements = this.cacheElements();
        this.passwordModalResolve = null;
    }
    
    cacheElements() {
        return {
            // Modo
            modeScan: document.getElementById('mode-scan'),
            modeGenerate: document.getElementById('mode-generate'),
            
            // Escaneo
            openCamera: document.getElementById('open-camera'),
            cameraModal: document.getElementById('camera-modal'),
            cameraStream: document.getElementById('camera-stream'),
            closeModal: document.getElementById('close-modal'),
            scanFeedback: document.getElementById('scan-feedback'),
            uploadFiles: document.getElementById('upload-files'),
            fileInput: document.getElementById('file-input'),
            
            // Progreso
            scanProgressContainer: document.getElementById('scan-progress-container'),
            scanProgressPercent: document.getElementById('scan-progress-percent'),
            scanProgressFill: document.getElementById('scan-progress-fill'),
            scannedFrames: document.getElementById('scanned-frames'),
            detectedQrs: document.getElementById('detected-qrs'),
            scanFps: document.getElementById('scan-fps'),
            
            // Generación
            generateFileInput: document.getElementById('generate-file-input'),
            dropZone: document.getElementById('drop-zone'),
            selectedFileInfo: document.getElementById('selected-file-info'),
            selectedFileName: document.getElementById('selected-file-name'),
            selectedFileSize: document.getElementById('selected-file-size'),
            removeFile: document.getElementById('remove-file'),
            
            generationProgress: document.querySelector('.generation-progress'),
            generationProgressPercent: document.getElementById('generation-progress-percent'),
            generationProgressFill: document.getElementById('generation-progress-fill'),
            generationStatus: document.getElementById('generation-status'),
            qrCount: document.getElementById('qr-count'),
            
            qrGallery: document.getElementById('qr-gallery'),
            generateQRBtn: document.getElementById('generate-qr'),
            downloadAllBtn: document.getElementById('download-all'),
            resetGeneration: document.getElementById('reset-generation'),
            
            // Opciones
            encryptionToggle: document.getElementById('encryption-toggle'),
            encryptionOptions: document.getElementById('encryption-options'),
            encryptionPassword: document.getElementById('encryption-password'),
            encryptionConfirm: document.getElementById('encryption-confirm'),
            
            // Tema
            themeToggle: document.getElementById('theme-toggle'),
            
            // Modal de contraseña
            passwordModal: document.getElementById('password-modal'),
            passwordInput: document.getElementById('password-input'),
            confirmPassword: document.getElementById('confirm-password'),
            cancelPassword: document.getElementById('cancel-password'),
            togglePassword: document.getElementById('toggle-password'),
            
            // Reconstrucción
            reconstructBtn: document.getElementById('reconstruct-btn')
        };
    }
    
    setupEventListeners() {
        // Modo
        this.elements.modeScan.addEventListener('click', () => this.app.switchMode('scan'));
        this.elements.modeGenerate.addEventListener('click', () => this.app.switchMode('generate'));
        
        // Cámara
        this.elements.openCamera.addEventListener('click', () => this.app.scanner.startCamera());
        this.elements.closeModal.addEventListener('click', () => this.app.scanner.stopCamera());
        
        // Subida de archivos (modo escaneo)
        this.elements.uploadFiles.addEventListener('click', () => this.elements.fileInput.click());
        this.elements.fileInput.addEventListener('change', (e) => this.handleScanFileUpload(e));
        
        // Generación - Subida de archivos
        this.elements.dropZone.addEventListener('click', () => this.elements.generateFileInput.click());
        this.elements.generateFileInput.addEventListener('change', (e) => this.handleFileSelect(e));
        this.elements.removeFile.addEventListener('click', () => this.clearSelectedFile());
        
        // Arrastrar y soltar
        this.elements.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            this.elements.dropZone.style.borderColor = 'var(--primary-color)';
            this.elements.dropZone.style.backgroundColor = 'rgba(0, 0, 0, 0.02)';
        });
        
        this.elements.dropZone.addEventListener('dragleave', () => {
            this.elements.dropZone.style.borderColor = 'var(--border-color)';
            this.elements.dropZone.style.backgroundColor = '';
        });
        
        this.elements.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            this.elements.dropZone.style.borderColor = 'var(--border-color)';
            this.elements.dropZone.style.backgroundColor = '';
            
            if (e.dataTransfer.files.length) {
                this.handleFileSelect({ target: { files: e.dataTransfer.files } });
            }
        });
        
        // Generar QR
        this.elements.generateQRBtn.addEventListener('click', async () => {
            if (!this.app.generator.file) {
                this.app.showNotification('Selecciona un archivo primero', 'warning');
                return;
            }
            
            if (this.app.generator.options.encryption) {
                const password = this.elements.encryptionPassword.value;
                const confirm = this.elements.encryptionConfirm.value;
                
                if (!password || password.length < 8) {
                    this.app.showNotification('La contraseña debe tener al menos 8 caracteres', 'warning');
                    return;
                }
                
                if (password !== confirm) {
                    this.app.showNotification('Las contraseñas no coinciden', 'error');
                    return;
                }
                
                this.app.generator.options.password = password;
            }
            
            try {
                this.elements.generateQRBtn.disabled = true;
                this.elements.generateQRBtn.innerHTML = '<span class="loading-spinner"></span>Generando...';
                
                const fileData = await this.app.generator.processFile(this.app.generator.file);
                await this.app.generator.generateQRs(fileData);
                
            } catch (error) {
                this.app.showNotification(`Error: ${error.message}`, 'error');
            } finally {
                this.elements.generateQRBtn.disabled = false;
                this.elements.generateQRBtn.innerHTML = '<span>⚡ Generar Códigos QR</span>';
            }
        });
        
        // Limpiar generación
        this.elements.resetGeneration.addEventListener('click', () => {
            this.app.generator.reset();
            this.app.showNotification('Generación limpiada', 'info');
        });
        
        // Cifrado
        this.elements.encryptionToggle.addEventListener('change', (e) => {
            this.elements.encryptionOptions.style.display = e.target.checked ? 'block' : 'none';
        });
        
        // Tema
        this.elements.themeToggle.addEventListener('click', () => this.toggleTheme());
        
        // Modal de contraseña
        this.elements.confirmPassword.addEventListener('click', () => this.handlePasswordConfirm());
        this.elements.cancelPassword.addEventListener('click', () => this.handlePasswordCancel());
        this.elements.togglePassword.addEventListener('click', () => this.togglePasswordVisibility());
        
        // Reconstrucción
        this.elements.reconstructBtn.addEventListener('click', () => this.app.scanner.startReconstruction());
    }
    
    handleScanFileUpload(event) {
        const files = Array.from(event.target.files);
        if (!files.length) return;
        
        this.app.showNotification(`Procesando ${files.length} archivo(s)...`, 'info');
        
        // Por simplicidad, procesamos solo el primer archivo
        const file = files[0];
        const reader = new FileReader();
        
        reader.onload = (e) => {
            // Crear una imagen para procesar con jsQR
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = img.width;
                canvas.height = img.height;
                ctx.drawImage(img, 0, 0);
                
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const code = jsQR(imageData.data, imageData.width, imageData.height);
                
                if (code) {
                    this.app.scanner.handleQRCode(code.data);
                    this.app.showNotification('QR detectado en imagen', 'success');
                } else {
                    this.app.showNotification('No se encontraron QR en la imagen', 'warning');
                }
            };
            img.src = e.target.result;
        };
        
        reader.readAsDataURL(file);
    }
    
    handleFileSelect(event) {
        const files = event.target.files;
        if (!files || files.length === 0) return;
        
        const file = files[0];
        this.app.generator.file = file;
        this.showSelectedFile(file);
    }
    
    showSelectedFile(file) {
        this.elements.selectedFileName.textContent = file.name;
        this.elements.selectedFileSize.textContent = this.app.formatSize(file.size);
        this.elements.selectedFileInfo.style.display = 'block';
        this.elements.generateQRBtn.disabled = false;
    }
    
    clearSelectedFile() {
        this.app.generator.file = null;
        this.elements.selectedFileInfo.style.display = 'none';
        this.elements.generateFileInput.value = '';
        this.elements.generateQRBtn.disabled = true;
    }
    
    updateMode(mode) {
        // Actualizar botones de modo
        document.querySelectorAll('.mode-btn').forEach(btn => btn.classList.remove('active'));
        document.getElementById(`mode-${mode}`).classList.add('active');
        
        // Mostrar/ocultar secciones
        document.querySelectorAll('.active-section').forEach(section => {
            section.classList.remove('active-section');
        });
        document.getElementById(`${mode}-section`).classList.add('active-section');
    }
    
    updateScanProgress(progress) {
        this.elements.scanProgressContainer.style.display = 'block';
        this.elements.scanProgressPercent.textContent = `${progress}%`;
        this.elements.scanProgressFill.style.width = `${progress}%`;
    }
    
    updateScannerStats(stats) {
        // Actualizar estadísticas en la UI
        document.getElementById('total-scanned').textContent = stats.totalScanned;
        document.getElementById('unique-blocks').textContent = stats.uniqueBlocks;
        document.getElementById('scan-fps').textContent = stats.fps;
        
        this.elements.scannedFrames.textContent = 'N/A'; // jsQR no proporciona frames
        this.elements.detectedQrs.textContent = stats.totalScanned;
        this.elements.scanFps.textContent = stats.fps;
    }
    
    showScanFeedback(message, type) {
        const feedback = this.elements.scanFeedback;
        feedback.textContent = message;
        feedback.className = `scan-feedback ${type}`;
        feedback.style.display = 'block';
        
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 1500);
    }
    
    showGenerationProgress(show) {
        this.elements.generationProgress.style.display = show ? 'block' : 'none';
    }
    
    updateGenerationProgress(percent) {
        this.app.state.generationProgress = percent;
        this.elements.generationProgressPercent.textContent = `${Math.round(percent)}%`;
        this.elements.generationProgressFill.style.width = `${percent}%`;
    }
    
    updateGenerationStatus(status) {
        this.elements.generationStatus.textContent = status;
    }
    
    addQRToGallery(qrItem, index) {
        const container = document.createElement('div');
        container.className = 'qr-item';
        container.innerHTML = `
            <canvas class="qr-canvas" id="qr-canvas-${index}" width="180" height="180"></canvas>
            <div class="qr-info">
                <div class="qr-index">Bloque ${index}</div>
                <div>${qrItem.type === 'metadata' ? '📋 Metadatos' : '📦 Datos'}</div>
            </div>
        `;
        
        this.elements.qrGallery.appendChild(container);
        
        // Generar QR visual
        setTimeout(() => {
            this.generateQRImage(qrItem.data, `qr-canvas-${index}`);
        }, 10);
    }
    
    generateQRImage(data, canvasId) {
        try {
            QRCode.toCanvas(document.getElementById(canvasId), data, {
                width: 180,
                margin: 1,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                },
                errorCorrectionLevel: 'M'
            });
        } catch (error) {
            console.warn('No se pudo generar QR visual:', error);
        }
    }
    
    enableDownload() {
        this.elements.downloadAllBtn.disabled = false;
        // TODO: Implementar descarga de todos los QR en un ZIP
    }
    
    resetGenerationUI() {
        this.elements.qrGallery.innerHTML = '';
        this.elements.selectedFileInfo.style.display = 'none';
        this.elements.generateFileInput.value = '';
        this.elements.generateQRBtn.disabled = true;
        this.elements.downloadAllBtn.disabled = true;
        this.elements.generationProgress.style.display = 'none';
    }
    
    showNotification(message, type, duration = 3000) {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <span>${message}</span>
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideIn 0.3s ease reverse';
            setTimeout(() => notification.remove(), 300);
        }, duration);
    }
    
    updateTheme() {
        const savedTheme = localStorage.getItem('shumzu_theme') || 'light';
        document.body.setAttribute('data-theme', savedTheme);
        this.elements.themeToggle.textContent = savedTheme === 'light' ? '🌙' : '☀️';
    }
    
    toggleTheme() {
        const current = document.body.getAttribute('data-theme') || 'light';
        const newTheme = current === 'light' ? 'dark' : 'light';
        document.body.setAttribute('data-theme', newTheme);
        localStorage.setItem('shumzu_theme', newTheme);
        this.elements.themeToggle.textContent = newTheme === 'light' ? '🌙' : '☀️';
    }
    
    displayFileInfo(metadata) {
        // Actualizar UI con información del archivo
        document.getElementById('file-info').style.display = 'block';
        document.getElementById('info-name').textContent = metadata.n || 'Desconocido';
        document.getElementById('info-size').textContent = this.app.formatSize(metadata.s || 0);
        document.getElementById('info-blocks').textContent = metadata.tb ? `${metadata.tb - 1} bloques` : '-';
        document.getElementById('info-encryption').textContent = metadata.e === 1 ? '🔒 Cifrado' : '🔓 No cifrado';
        document.getElementById('info-date').textContent = metadata.t ? 
            new Date(metadata.t * 1000).toLocaleDateString() : 'Desconocido';
        document.getElementById('info-hash').textContent = metadata.h ? 
            metadata.h.substring(0, 32) + '...' : 'No disponible';
        
        this.elements.reconstructBtn.style.display = 'block';
    }
    
    showCameraModal() {
        this.elements.cameraModal.style.display = 'flex';
        // Iniciar escaneo cuando el video esté listo
        const video = this.elements.cameraStream;
        video.onloadedmetadata = () => {
            this.app.scanner.startScanning(video);
        };
    }
    
    hideCameraModal() {
        this.elements.cameraModal.style.display = 'none';
    }
    
    showPasswordModal() {
        return new Promise((resolve) => {
            this.passwordModalResolve = resolve;
            this.elements.passwordModal.style.display = 'flex';
            this.elements.passwordInput.focus();
        });
    }
    
    hidePasswordModal() {
        this.elements.passwordModal.style.display = 'none';
        this.elements.passwordInput.value = '';
    }
    
    handlePasswordConfirm() {
        const password = this.elements.passwordInput.value;
        if (password) {
            this.hidePasswordModal();
            if (this.passwordModalResolve) {
                this.passwordModalResolve(password);
                this.passwordModalResolve = null;
            }
        } else {
            this.app.showNotification('Ingresa una contraseña', 'warning');
        }
    }
    
    handlePasswordCancel() {
        this.hidePasswordModal();
        if (this.passwordModalResolve) {
            this.passwordModalResolve(null);
            this.passwordModalResolve = null;
        }
    }
    
    togglePasswordVisibility() {
        const input = this.elements.passwordInput;
        input.type = input.type === 'password' ? 'text' : 'password';
    }
}

// Inicializar aplicación
document.addEventListener('DOMContentLoaded', () => {
    window.SHUMZU_APP = new SHUMZUApp();
});
