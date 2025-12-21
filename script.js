// script.js - CÓDIGO PRINCIPAL DE LA APLICACIÓN SHUMZU+
document.addEventListener('DOMContentLoaded', function() {
    // ==================== VARIABLES GLOBALES ====================
    let shumzuDecoder = new SHUMZUCompat();
    let cameraStream = null;
    let isScanning = false;
    let isProcessing = false;
    let animationFrame = null;
    let currentWorker = null;
    let currentFile = null;
    let qrCodesGenerated = [];
    let scanHistory = JSON.parse(localStorage.getItem('shumzu_history') || '[]');
    let currentQRIndex = 0;
    let scanningInterval = null;
    let lastScanTime = 0;
    
    // ==================== INICIALIZACIÓN ====================
    initTheme();
    loadHistory();
    initEventListeners();
    
    // ==================== FUNCIONES DE INICIALIZACIÓN ====================
    function initEventListeners() {
        // Modo de operación
        document.getElementById('mode-scan').addEventListener('click', () => switchMode('scan'));
        document.getElementById('mode-generate').addEventListener('click', () => switchMode('generate'));
        
        // Botones de escaneo
        document.getElementById('open-camera').addEventListener('click', openCameraModal);
        document.getElementById('upload-files').addEventListener('click', () => document.getElementById('file-input').click());
        document.getElementById('file-input').addEventListener('change', handleFileUpload);
        
        // Reconstrucción
        document.getElementById('reconstruct-btn').addEventListener('click', startReconstruction);
        document.getElementById('cancel-reconstruction').addEventListener('click', cancelReconstruction);
        document.getElementById('export-data').addEventListener('click', exportScanData);
        
        // Cámara modal
        document.getElementById('close-modal').addEventListener('click', closeCameraModal);
        document.getElementById('pause-scan').addEventListener('click', pauseScanning);
        document.getElementById('resume-scan').addEventListener('click', resumeScanning);
        document.getElementById('save-scan').addEventListener('click', saveScanProgress);
        
        // Controles de tema
        document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
        
        // Modales
        document.getElementById('close-password-modal').addEventListener('click', closePasswordModal);
        document.getElementById('close-metadata-modal').addEventListener('click', closeMetadataModal);
        document.getElementById('confirm-password').addEventListener('click', confirmPassword);
        document.getElementById('cancel-password').addEventListener('click', closePasswordModal);
        document.getElementById('toggle-password').addEventListener('click', () => togglePasswordVisibility('password-input'));
        document.getElementById('show-metadata').addEventListener('click', showMetadataModal);
        
        // Generación de QR - CORREGIDO
        document.getElementById('generate-file-input').addEventListener('change', handleFileForGeneration);
        document.getElementById('drop-zone').addEventListener('click', () => document.getElementById('generate-file-input').click());
        document.getElementById('drop-zone').addEventListener('dragover', handleDragOver);
        document.getElementById('drop-zone').addEventListener('dragleave', handleDragLeave);
        document.getElementById('drop-zone').addEventListener('drop', handleFileDrop);
        document.getElementById('encryption-toggle').addEventListener('change', toggleEncryptionOptions);
        document.getElementById('generate-qr').addEventListener('click', generateQRCodes);
        document.getElementById('prev-qr').addEventListener('click', showPrevQR);
        document.getElementById('next-qr').addEventListener('click', showNextQR);
        document.getElementById('download-gif').addEventListener('click', downloadGIF);
        document.getElementById('download-zip').addEventListener('click', downloadZIP);
        document.getElementById('reset-generation').addEventListener('click', resetGeneration);
        
        // Filtros de historial
        document.getElementById('filter-all').addEventListener('click', () => filterHistory('all'));
        document.getElementById('filter-scans').addEventListener('click', () => filterHistory('scans'));
        document.getElementById('filter-generations').addEventListener('click', () => filterHistory('generations'));
        
        // Asignar evento al botón eliminar archivo (se asigna dinámicamente)
        document.addEventListener('click', function(e) {
            if (e.target && e.target.id === 'remove-file') {
                removeSelectedFile();
            }
        });
    }
    
    function initTheme() {
        const savedTheme = localStorage.getItem('shumzu_theme') || 'light';
        document.documentElement.setAttribute('data-theme', savedTheme);
        updateThemeIcon(savedTheme);
    }
    
    function loadHistory() {
        const historyList = document.getElementById('history-list');
        if (scanHistory.length === 0) {
            historyList.innerHTML = '<p class="no-history">No hay actividad reciente</p>';
            return;
        }
        
        historyList.innerHTML = '';
        scanHistory.slice(0, 10).forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div class="history-info">
                    <div class="history-name">${item.name || 'Archivo'}</div>
                    <div class="history-details">
                        ${formatBytes(item.size)} • ${new Date(item.timestamp).toLocaleDateString()} • ${item.type === 'scan' ? '📱 Escaneado' : '⚡ Generado'}
                    </div>
                </div>
                <button class="download-btn" onclick="window.downloadFile(${JSON.stringify(item.data)}, '${item.name}')">
                    ⬇️ Descargar
                </button>
            `;
            historyList.appendChild(historyItem);
        });
    }
    
    // ==================== FUNCIONES DE MODO ====================
    function switchMode(mode) {
        const scanSection = document.getElementById('scan-section');
        const generateSection = document.getElementById('generate-section');
        const scanBtn = document.getElementById('mode-scan');
        const generateBtn = document.getElementById('mode-generate');
        
        if (mode === 'scan') {
            scanSection.style.display = 'block';
            generateSection.style.display = 'none';
            scanBtn.classList.add('active');
            generateBtn.classList.remove('active');
            shumzuDecoder = new SHUMZUCompat();
        } else {
            scanSection.style.display = 'none';
            generateSection.style.display = 'block';
            generateBtn.classList.add('active');
            scanBtn.classList.remove('active');
            resetGeneration();
        }
    }
    
    // ==================== FUNCIONES DE ESCANEO ====================
    async function openCameraModal() {
        const modal = document.getElementById('camera-modal');
        modal.style.display = 'flex';
        
        try {
            const constraints = {
                video: {
                    facingMode: 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                    frameRate: { ideal: 30 }
                }
            };
            
            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            const video = document.getElementById('camera-stream');
            video.srcObject = cameraStream;
            
            // Generar cuadrícula de escaneo
            generateScanGrid();
            
            // Iniciar escaneo
            startQRScanning();
            
            // Iniciar estadísticas
            startScanStats();
            
        } catch (error) {
            console.error('Error al acceder a la cámara:', error);
            showNotification('No se pudo acceder a la cámara. Asegúrate de permitir el acceso.', 'error');
            closeCameraModal();
        }
    }
    
    function generateScanGrid() {
        const grid = document.querySelector('.scan-grid');
        grid.innerHTML = '';
        
        for (let i = 0; i < 9; i++) {
            const cell = document.createElement('div');
            cell.className = 'scan-cell';
            grid.appendChild(cell);
        }
    }
    
    function startQRScanning() {
        if (isScanning) return;
        
        isScanning = true;
        const video = document.getElementById('camera-stream');
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        let scanCount = 0;
        let lastStatsUpdate = Date.now();
        
        function scanFrame() {
            if (!isScanning || !video.videoWidth) {
                animationFrame = requestAnimationFrame(scanFrame);
                return;
            }
            
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            // Escanear QR
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const codes = detectMultipleQRs(imageData, canvas.width, canvas.height);
            
            // Procesar códigos detectados
            if (codes.length > 0) {
                codes.forEach(code => {
                    processQRData(code.data);
                    highlightQRCell(code.location);
                });
                scanCount += codes.length;
                
                // Mostrar feedback
                showScanFeedback(`✓ ${codes.length} QR detectado(s)`);
            }
            
            // Actualizar estadísticas cada segundo
            const now = Date.now();
            if (now - lastStatsUpdate >= 1000) {
                updateScanStats(scanCount, now);
                scanCount = 0;
                lastStatsUpdate = now;
            }
            
            animationFrame = requestAnimationFrame(scanFrame);
        }
        
        scanFrame();
    }
    
    function highlightQRCell(location) {
        const cells = document.querySelectorAll('.scan-cell');
        const video = document.getElementById('camera-stream');
        
        // Calcular posición relativa
        const centerX = (location.topLeftCorner.x + location.bottomRightCorner.x) / 2;
        const centerY = (location.topLeftCorner.y + location.bottomRightCorner.y) / 2;
        
        // Determinar celda (3x3 grid)
        const cellX = Math.floor((centerX / video.videoWidth) * 3);
        const cellY = Math.floor((centerY / video.videoHeight) * 3);
        const cellIndex = cellY * 3 + cellX;
        
        if (cells[cellIndex]) {
            cells[cellIndex].classList.add('active');
            setTimeout(() => cells[cellIndex].classList.remove('active'), 500);
        }
    }
    
    function startScanStats() {
        let totalScanned = 0;
        let uniqueBlocks = new Set();
        
        scanningInterval = setInterval(() => {
            const stats = shumzuDecoder.getStatistics();
            uniqueBlocks = new Set([...uniqueBlocks, ...Array.from(shumzuDecoder.qrData.keys())]);
            
            document.getElementById('total-scanned').textContent = totalScanned;
            document.getElementById('unique-blocks').textContent = uniqueBlocks.size;
            document.getElementById('scan-resolution').textContent = 
                cameraStream ? `${cameraStream.getVideoTracks()[0].getSettings().width || 0}x${cameraStream.getVideoTracks()[0].getSettings().height || 0}` : '-';
        }, 1000);
    }
    
    function updateScanStats(scanCount, timestamp) {
        const timeDiff = timestamp - lastScanTime;
        const qrPerSec = timeDiff > 0 ? (scanCount / (timeDiff / 1000)).toFixed(1) : 0;
        
        document.getElementById('scanned-frames').textContent = scanCount;
        document.getElementById('scan-fps').textContent = qrPerSec;
        document.getElementById('scan-speed').textContent = qrPerSec;
        
        lastScanTime = timestamp;
    }
    
    function processQRData(data) {
        try {
            // Detectar formato
            const format = detectSHUMZUFormat(data);
            
            if (format === 'python') {
                const result = shumzuDecoder.decodePythonQR(data);
                
                if (result && result.type === 'metadata') {
                    showFileInfo(result.metadata);
                }
                
                // Actualizar progreso
                updateScanProgress();
                
                // Verificar si tenemos suficiente para reconstrucción automática
                if (document.getElementById('auto-reconstruct').checked) {
                    const stats = shumzuDecoder.getStatistics();
                    if (stats.receivedBlocks >= Math.floor(stats.totalBlocks * 0.7)) {
                        showNotification('Suficientes bloques para reconstrucción automática', 'info');
                        if (!isProcessing) {
                            startReconstruction();
                        }
                    }
                }
            } else {
                console.log('Formato no compatible:', format);
            }
        } catch (error) {
            console.warn('Error procesando QR:', error);
        }
    }
    
    function showFileInfo(metadata) {
        document.getElementById('info-name').textContent = metadata.n || 'Sin nombre';
        document.getElementById('info-size').textContent = formatBytes(metadata.s);
        document.getElementById('info-blocks').textContent = `${metadata.tb - 1} bloques`;
        document.getElementById('info-encryption').textContent = metadata.e === 1 ? '🔒 Cifrado' : '🔓 Sin cifrar';
        document.getElementById('info-date').textContent = new Date(metadata.d || Date.now()).toLocaleDateString();
        document.getElementById('info-hash').textContent = metadata.h ? 
            `${metadata.h.substring(0, 16)}...${metadata.h.substring(metadata.h.length - 16)}` : 'N/A';
        
        document.getElementById('file-info').style.display = 'block';
        document.getElementById('reconstruct-btn').style.display = 'block';
        document.getElementById('compatibility-status').textContent = 'SHUMZU Python ✓';
    }
    
    function updateScanProgress() {
        const stats = shumzuDecoder.getStatistics();
        const progress = stats.progress;
        
        document.getElementById('scan-progress-fill').style.width = `${progress}%`;
        document.getElementById('scan-progress-percent').textContent = `${progress}%`;
        document.getElementById('detected-qrs').textContent = stats.receivedBlocks || 0;
        document.getElementById('scan-progress-container').style.display = 'block';
        
        // Actualizar cuadrícula de bloques
        updateBlockGrid();
    }
    
    function updateBlockGrid() {
        const blockGrid = document.getElementById('block-grid');
        const stats = shumzuDecoder.getStatistics();
        
        blockGrid.innerHTML = '';
        
        for (let i = 1; i <= (stats.totalBlocks || 0); i++) {
            const block = document.createElement('div');
            block.className = 'block-indicator';
            block.textContent = i;
            
            if (shumzuDecoder.qrData.has(i)) {
                block.classList.add('received');
            } else {
                block.classList.add('missing');
            }
            
            blockGrid.appendChild(block);
        }
    }
    
    // ==================== FUNCIONES DE GENERACIÓN MEJORADAS ====================
    function handleFileForGeneration(event) {
        event.preventDefault();
        
        const file = event.target.files[0];
        if (!file) return;
        
        // Validar tamaño máximo (50MB)
        const maxSize = 50 * 1024 * 1024; // 50MB en bytes
        if (file.size > maxSize) {
            showNotification(`El archivo es demasiado grande (${formatBytes(file.size)}). Máximo: ${formatBytes(maxSize)}`, 'error');
            resetGeneration();
            return;
        }
        
        // Validar tipo de archivo
        const allowedTypes = [
            'application/pdf',
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'text/plain', 'text/csv', 'text/html',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip',
            'application/json',
            'application/xml',
            'application/octet-stream' // Para otros archivos
        ];
        
        const fileExtension = file.name.split('.').pop().toLowerCase();
        const allowedExtensions = ['txt', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'csv', 'doc', 'docx', 'xls', 'xlsx', 'zip', 'json', 'xml'];
        
        if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
            showNotification('Tipo de archivo no soportado. Use archivos comunes como PDF, imágenes, texto, etc.', 'warning');
            resetGeneration();
            return;
        }
        
        currentFile = file;
        showSelectedFile(file);
        document.getElementById('generate-qr').disabled = false;
        
        // Habilitar opciones de cifrado si el archivo es sensible
        if (file.type.includes('pdf') || file.type.includes('doc') || file.type.includes('xls') || file.type.includes('zip')) {
            showNotification('Considera usar cifrado para archivos sensibles', 'info');
        }
    }
    
    function showSelectedFile(file) {
        const fileInfo = document.getElementById('selected-file-info');
        
        // Agregar icono según tipo de archivo
        let icon = '📄';
        if (file.type.startsWith('image/')) icon = '🖼️';
        if (file.type.includes('pdf')) icon = '📕';
        if (file.type.includes('text/')) icon = '📝';
        if (file.type.includes('zip')) icon = '🗜️';
        if (file.type.includes('doc')) icon = '📘';
        if (file.type.includes('xls')) icon = '📗';
        
        fileInfo.innerHTML = `
            <div class="file-preview">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1;">
                    <span id="selected-file-name" style="font-weight: 500;">${icon} ${file.name}</span>
                    <span id="selected-file-size" style="color: var(--secondary-color); font-size: 0.9rem;">${formatBytes(file.size)}</span>
                </div>
                <button id="remove-file" class="btn-cancel small">✕ Eliminar</button>
            </div>
        `;
        
        fileInfo.style.display = 'block';
        
        // Animar la aparición
        fileInfo.style.animation = 'slideIn 0.3s ease';
    }
    
    function handleDragOver(event) {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'copy';
        
        const dropZone = document.getElementById('drop-zone');
        dropZone.style.borderColor = 'var(--success-color)';
        dropZone.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
    }
    
    function handleDragLeave(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const dropZone = document.getElementById('drop-zone');
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.backgroundColor = '';
    }
    
    function handleFileDrop(event) {
        event.preventDefault();
        event.stopPropagation();
        
        const dropZone = document.getElementById('drop-zone');
        dropZone.style.borderColor = 'var(--border-color)';
        dropZone.style.backgroundColor = '';
        
        const files = event.dataTransfer.files;
        if (files.length > 0) {
            // Usar el primer archivo
            const fileInput = document.getElementById('generate-file-input');
            
            // Crear un nuevo DataTransfer para simular el input
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(files[0]);
            fileInput.files = dataTransfer.files;
            
            // Disparar el evento change
            const changeEvent = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(changeEvent);
        }
    }
    
    function removeSelectedFile() {
        currentFile = null;
        document.getElementById('selected-file-info').style.display = 'none';
        document.getElementById('generate-qr').disabled = true;
        document.getElementById('generate-file-input').value = '';
        showNotification('Archivo eliminado', 'info');
    }
    
    function toggleEncryptionOptions() {
        const encryptionOptions = document.getElementById('encryption-options');
        const isChecked = document.getElementById('encryption-toggle').checked;
        encryptionOptions.style.display = isChecked ? 'block' : 'none';
    }
    
    async function generateQRCodes() {
        if (!currentFile) {
            showNotification('Por favor selecciona un archivo primero', 'warning');
            return;
        }
        
        // Validar contraseña si cifrado está activado
        const useEncryption = document.getElementById('encryption-toggle').checked;
        let password = '';
        
        if (useEncryption) {
            password = document.getElementById('encryption-password').value;
            const confirmPassword = document.getElementById('encryption-confirm').value;
            
            if (!password || password.length < 8) {
                showNotification('La contraseña debe tener al menos 8 caracteres', 'error');
                return;
            }
            
            if (password !== confirmPassword) {
                showNotification('Las contraseñas no coinciden', 'error');
                return;
            }
        }
        
        // Mostrar progreso
        const progressContainer = document.querySelector('.generation-progress');
        progressContainer.style.display = 'block';
        updateGenerationProgress(0, 100);
        
        const reader = new FileReader();
        
        reader.onload = async function(e) {
            try {
                const fileData = new Uint8Array(e.target.result);
                const qrQuality = document.getElementById('qr-quality').value;
                const blockSize = parseInt(document.getElementById('block-size').value);
                const useCompression = document.getElementById('compression-toggle').checked;
                
                // Calcular hash del archivo
                const fileHash = await calculateSHA256(fileData);
                
                // Comprimir datos si está activado
                let processedData = fileData;
                let compressedSize = fileData.length;
                
                if (useCompression) {
                    try {
                        processedData = pako.deflate(fileData);
                        compressedSize = processedData.length;
                        showNotification(`Datos comprimidos: ${formatBytes(fileData.length)} → ${formatBytes(compressedSize)}`, 'info');
                    } catch (error) {
                        console.warn('Error comprimiendo, usando datos sin comprimir:', error);
                        showNotification('No se pudo comprimir el archivo', 'warning');
                    }
                }
                
                // Dividir en bloques
                const totalBlocks = Math.ceil(processedData.length / blockSize);
                const blocks = [];
                
                showNotification(`Dividiendo archivo en ${totalBlocks} bloques...`, 'info');
                
                for (let i = 0; i < totalBlocks; i++) {
                    const start = i * blockSize;
                    const end = Math.min(start + blockSize, processedData.length);
                    const block = processedData.slice(start, end);
                    blocks.push(block);
                }
                
                // Generar códigos QR
                qrCodesGenerated = [];
                const qrContainer = document.getElementById('generation-block-grid');
                qrContainer.innerHTML = '';
                
                // Crear metadatos
                const metadata = {
                    n: currentFile.name,
                    s: fileData.length,
                    tb: totalBlocks + 1, // +1 para el bloque de metadatos
                    e: useEncryption ? 1 : 0,
                    c: useCompression ? 1 : 0,
                    bs: blockSize,
                    d: Date.now(),
                    h: fileHash,
                    version: 'SHZv4+Web'
                };
                
                // Generar bloque de metadatos (bloque 0)
                const metadataBlock = {
                    i: 0,
                    m: metadata
                };
                
                // Incluir el primer bloque de datos en los metadatos si es pequeño
                if (blocks[0] && blocks[0].length <= 500) {
                    metadataBlock.d = arrayBufferToBase64(blocks[0]);
                }
                
                // Generar QR para metadatos
                try {
                    const metadataQR = await generateQRCode(JSON.stringify(metadataBlock), qrQuality);
                    qrCodesGenerated.push({
                        canvas: metadataQR,
                        data: metadataBlock,
                        index: 0,
                        isMetadata: true
                    });
                    
                    const metadataElement = document.createElement('div');
                    metadataElement.className = 'generation-block completed';
                    metadataElement.textContent = 'M';
                    metadataElement.title = 'Metadatos';
                    metadataElement.style.backgroundColor = '#4CAF50';
                    qrContainer.appendChild(metadataElement);
                    
                    updateGenerationProgress(1, totalBlocks + 1);
                } catch (error) {
                    console.error('Error generando QR de metadatos:', error);
                    showNotification('Error generando metadatos', 'error');
                    return;
                }
                
                // Generar QRs para bloques de datos
                for (let i = 0; i < blocks.length; i++) {
                    try {
                        const blockData = blocks[i];
                        
                        // Cifrar bloque si es necesario
                        let finalBlockData = blockData;
                        if (useEncryption && password) {
                            finalBlockData = await encryptBlock(blockData, password);
                        }
                        
                        const qrData = {
                            i: i + 1,
                            d: arrayBufferToBase64(finalBlockData)
                        };
                        
                        // Generar QR
                        const qrText = JSON.stringify(qrData);
                        const qrCode = await generateQRCode(qrText, qrQuality);
                        
                        qrCodesGenerated.push({
                            canvas: qrCode,
                            data: qrData,
                            index: i + 1,
                            isMetadata: false
                        });
                        
                        // Mostrar bloque en la interfaz
                        const blockElement = document.createElement('div');
                        blockElement.className = 'generation-block completed';
                        blockElement.textContent = i + 1;
                        blockElement.title = `Bloque ${i + 1}: ${formatBytes(blockData.length)}`;
                        qrContainer.appendChild(blockElement);
                        
                        // Actualizar progreso
                        updateGenerationProgress(i + 2, totalBlocks + 1);
                        
                        // Pequeña pausa para no bloquear la UI
                        if (i % 3 === 0) {
                            await new Promise(resolve => setTimeout(resolve, 50));
                        }
                        
                    } catch (error) {
                        console.error(`Error generando QR para bloque ${i + 1}:`, error);
                        const errorElement = document.createElement('div');
                        errorElement.className = 'generation-block error';
                        errorElement.textContent = i + 1;
                        errorElement.title = `Error en bloque ${i + 1}`;
                        qrContainer.appendChild(errorElement);
                    }
                }
                
                showNotification(`✅ ${qrCodesGenerated.length} códigos QR generados exitosamente`, 'success');
                
                // Habilitar botones de descarga
                document.getElementById('download-gif').disabled = false;
                document.getElementById('download-zip').disabled = false;
                
                // Mostrar vista previa del primer QR
                currentQRIndex = 0;
                showQRPreview(currentQRIndex);
                
                // Guardar en historial
                addToHistory({
                    name: currentFile.name,
                    size: currentFile.size,
                    type: 'generation',
                    timestamp: Date.now(),
                    blocks: qrCodesGenerated.length,
                    encrypted: useEncryption
                });
                
            } catch (error) {
                console.error('Error en generación:', error);
                showNotification(`Error generando códigos QR: ${error.message}`, 'error');
            }
        };
        
        reader.onerror = function() {
            showNotification('Error leyendo el archivo', 'error');
        };
        
        reader.readAsArrayBuffer(currentFile);
    }
    
    async function encryptBlock(data, password) {
        try {
            // Generar salt aleatorio
            const salt = crypto.getRandomValues(new Uint8Array(16));
            
            // Derivar clave usando PBKDF2
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
                ['encrypt']
            );
            
            // Generar IV aleatorio
            const iv = crypto.getRandomValues(new Uint8Array(12));
            
            // Cifrar datos
            const encrypted = await crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                key,
                data
            );
            
            // Combinar salt + iv + datos cifrados
            const result = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
            result.set(salt, 0);
            result.set(iv, salt.length);
            result.set(new Uint8Array(encrypted), salt.length + iv.length);
            
            return result;
            
        } catch (error) {
            console.error('Error cifrando bloque:', error);
            throw new Error('Error en cifrado');
        }
    }
    
    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    
    async function generateQRCode(text, quality) {
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                const options = {
                    errorCorrectionLevel: quality,
                    margin: 1,
                    width: 300,
                    color: {
                        dark: '#000000',
                        light: '#FFFFFF'
                    }
                };
                
                QRCode.toCanvas(canvas, text, options, (error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(canvas);
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }
    
    function showQRPreview(index) {
        if (!qrCodesGenerated || qrCodesGenerated.length === 0) {
            return;
        }
        
        const qrInfo = qrCodesGenerated[index];
        const canvas = document.getElementById('qr-canvas-preview');
        const ctx = canvas.getContext('2d');
        
        // Limpiar canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Dibujar QR
        ctx.drawImage(qrInfo.canvas, 0, 0, canvas.width, canvas.height);
        
        // Actualizar información
        document.getElementById('current-qr-index').textContent = `${index + 1}/${qrCodesGenerated.length}`;
        
        if (qrInfo.isMetadata) {
            document.getElementById('qr-type').textContent = '📋 Metadatos';
            document.getElementById('qr-data-size').textContent = `Archivo: ${currentFile ? currentFile.name : 'N/A'}`;
        } else {
            document.getElementById('qr-type').textContent = `🧩 Bloque ${qrInfo.index}`;
            const dataSize = qrInfo.data.d ? Math.ceil(qrInfo.data.d.length * 0.75) : 0;
            document.getElementById('qr-data-size').textContent = `Datos: ~${Math.ceil(dataSize / 1024)} KB`;
        }
        
        // Actualizar controles de navegación
        document.getElementById('prev-qr').disabled = index <= 0;
        document.getElementById('next-qr').disabled = index >= qrCodesGenerated.length - 1;
    }
    
    function showPrevQR() {
        if (currentQRIndex > 0) {
            currentQRIndex--;
            showQRPreview(currentQRIndex);
        }
    }
    
    function showNextQR() {
        if (currentQRIndex < qrCodesGenerated.length - 1) {
            currentQRIndex++;
            showQRPreview(currentQRIndex);
        }
    }
    
    async function downloadGIF() {
        if (!qrCodesGenerated || qrCodesGenerated.length === 0) {
            showNotification('No hay códigos QR generados', 'warning');
            return;
        }
        
        showNotification('Generando GIF animado... Esto puede tomar unos momentos', 'info');
        
        try {
            // Usar gif.js para crear el GIF
            const gif = new GIF({
                workers: 2,
                quality: 10,
                width: 300,
                height: 300,
                workerScript: 'gif.worker.js'
            });
            
            // Agregar cada frame
            qrCodesGenerated.forEach((qr, index) => {
                const canvas = document.createElement('canvas');
                canvas.width = 300;
                canvas.height = 300;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(qr.canvas, 0, 0);
                
                gif.addFrame(canvas, { 
                    delay: parseInt(document.getElementById('frame-delay').value)
                });
            });
            
            gif.on('finished', function(blob) {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                const fileName = currentFile ? 
                    currentFile.name.replace(/\.[^/.]+$/, "") : 
                    'shumzu_qr_codes';
                a.download = `${fileName}_${qrCodesGenerated.length}_bloques.gif`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                
                showNotification('✅ GIF descargado exitosamente', 'success');
                
                // Agregar al historial
                addToHistory({
                    name: `${fileName}.gif`,
                    size: blob.size,
                    type: 'download',
                    timestamp: Date.now(),
                    format: 'gif'
                });
            });
            
            gif.on('progress', function(p) {
                console.log(`Progreso GIF: ${Math.round(p * 100)}%`);
            });
            
            gif.render();
            
        } catch (error) {
            console.error('Error generando GIF:', error);
            showNotification('Error generando GIF. Intentando método alternativo...', 'warning');
            
            // Método alternativo: crear un GIF simple con el primer frame
            try {
                const canvas = qrCodesGenerated[0].canvas;
                const dataUrl = canvas.toDataURL('image/gif');
                const a = document.createElement('a');
                a.href = dataUrl;
                a.download = 'shumzu_qr_single.gif';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                
                showNotification('✅ Imagen GIF descargada (solo primer código)', 'success');
            } catch (fallbackError) {
                showNotification('No se pudo generar el GIF', 'error');
            }
        }
    }
    
    async function downloadZIP() {
        if (!qrCodesGenerated || qrCodesGenerated.length === 0) {
            showNotification('No hay códigos QR generados', 'warning');
            return;
        }
        
        showNotification('Generando archivo ZIP...', 'info');
        
        try {
            const zip = new JSZip();
            const folder = zip.folder("shumzu_qr_codes");
            
            // Agregar archivo de información
            const infoContent = `
SHUMZU+ QR Codes - Archivo generado
===================================

Información del archivo original:
---------------------------------
Nombre: ${currentFile ? currentFile.name : 'Desconocido'}
Tamaño: ${currentFile ? formatBytes(currentFile.size) : '0 B'}
Fecha: ${new Date().toLocaleString()}

Información de la generación:
-----------------------------
Códigos QR generados: ${qrCodesGenerated.length}
Bloques de datos: ${qrCodesGenerated.filter(q => !q.isMetadata).length}
Tamaño de bloque: ${document.getElementById('block-size').value} bytes
Calidad: ${document.getElementById('qr-quality').options[document.getElementById('qr-quality').selectedIndex].text}
Cifrado: ${document.getElementById('encryption-toggle').checked ? 'Sí' : 'No'}
Compresión: ${document.getElementById('compression-toggle').checked ? 'Sí' : 'No'}

Instrucciones para reconstruir:
-------------------------------
1. Usa SHUMZU+ o shumzuX.py para escanear estos códigos
2. Escanea todos los códigos QR en orden
3. El archivo se reconstruirá automáticamente

Nota: El primer código QR (00_metadata.png) contiene los metadatos.

Compatibilidad: SHUMZU Python, SHUMZU+ Web
Versión: SHZv4+
            `;
            
            folder.file("00_INFORMACION.txt", infoContent);
            
            // Agregar cada código QR como imagen PNG
            qrCodesGenerated.forEach((qr, index) => {
                const canvas = qr.canvas;
                const dataUrl = canvas.toDataURL('image/png');
                const base64Data = dataUrl.split(',')[1];
                
                const fileName = qr.isMetadata ? 
                    `00_metadata.png` : 
                    `${(index).toString().padStart(3, '0')}_bloque_${qr.index}.png`;
                
                folder.file(fileName, base64Data, { base64: true });
            });
            
            // Generar y descargar ZIP
            const content = await zip.generateAsync({ 
                type: "blob",
                compression: "DEFLATE",
                compressionOptions: {
                    level: 6
                }
            });
            
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            const fileName = currentFile ? 
                currentFile.name.replace(/\.[^/.]+$/, "") : 
                'shumzu_qr_codes';
            a.download = `${fileName}_${qrCodesGenerated.length}_bloques.zip`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            showNotification('✅ ZIP descargado exitosamente', 'success');
            
            // Agregar al historial
            addToHistory({
                name: `${fileName}.zip`,
                size: content.size,
                type: 'download',
                timestamp: Date.now(),
                format: 'zip',
                qrCount: qrCodesGenerated.length
            });
            
        } catch (error) {
            console.error('Error generando ZIP:', error);
            showNotification('Error generando archivo ZIP', 'error');
        }
    }
    
    function updateGenerationProgress(current, total) {
        const percent = Math.round((current / total) * 100);
        const progressFill = document.getElementById('generation-progress-fill');
        const progressPercent = document.getElementById('generation-progress-percent');
        const generationStatus = document.getElementById('generation-status');
        const qrCount = document.getElementById('qr-count');
        
        if (progressFill) {
            progressFill.style.width = `${percent}%`;
        }
        
        if (progressPercent) {
            progressPercent.textContent = `${percent}%`;
        }
        
        if (generationStatus) {
            if (current === 0) {
                generationStatus.textContent = 'Preparando...';
            } else if (current < total) {
                generationStatus.textContent = `Generando bloque ${current} de ${total}`;
            } else {
                generationStatus.textContent = '✅ Completado';
            }
        }
        
        if (qrCount) {
            qrCount.textContent = `${current}/${total}`;
        }
    }
    
    function resetGeneration() {
        currentFile = null;
        qrCodesGenerated = [];
        currentQRIndex = 0;
        
        // Limpiar interfaz
        document.getElementById('selected-file-info').style.display = 'none';
        document.getElementById('generate-file-input').value = '';
        document.getElementById('generate-qr').disabled = true;
        document.getElementById('download-gif').disabled = true;
        document.getElementById('download-zip').disabled = true;
        document.querySelector('.generation-progress').style.display = 'none';
        
        // Limpiar canvas de vista previa
        const canvas = document.getElementById('qr-canvas-preview');
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Restablecer información
        document.getElementById('current-qr-index').textContent = '0/0';
        document.getElementById('qr-type').textContent = 'Tipo: -';
        document.getElementById('qr-data-size').textContent = 'Datos: -';
        
        // Limpiar cuadrícula de bloques
        const blockGrid = document.getElementById('generation-block-grid');
        blockGrid.innerHTML = '';
        
        // Restablecer campos de contraseña
        document.getElementById('encryption-password').value = '';
        document.getElementById('encryption-confirm').value = '';
        document.getElementById('encryption-options').style.display = 'none';
        document.getElementById('encryption-toggle').checked = false;
        
        showNotification('Generación reiniciada', 'info');
    }
    
    // ==================== RECONSTRUCCIÓN ====================
    async function startReconstruction() {
        if (isProcessing) return;
        
        const stats = shumzuDecoder.getStatistics();
        
        if (!stats.metadata) {
            showNotification('No se han detectado metadatos', 'error');
            return;
        }
        
        if (stats.receivedBlocks < Math.floor(stats.totalBlocks * 0.5)) {
            showNotification(`Se necesitan al menos el 50% de los bloques (${stats.receivedBlocks}/${stats.totalBlocks})`, 'warning');
            return;
        }
        
        isProcessing = true;
        
        // Mostrar progreso
        document.getElementById('reconstruction-progress-container').style.display = 'block';
        updateReconstructionProgress(0, stats.totalBlocks);
        
        // Crear worker
        currentWorker = new Worker('worker.js');
        
        currentWorker.onmessage = function(event) {
            const { type, data, error } = event.data;
            
            switch (type) {
                case 'initialized':
                    showNotification('Worker inicializado', 'info');
                    break;
                    
                case 'progress':
                    updateReconstructionProgress(data.current, data.total);
                    break;
                    
                case 'result':
                    handleReconstructionResult(data);
                    break;
                    
                case 'error':
                    showNotification(`Error: ${error || data}`, 'error');
                    isProcessing = false;
                    break;
                    
                case 'ack':
                    // Confirmación de procesamiento
                    break;
            }
        };
        
        currentWorker.onerror = function(error) {
            console.error('Error en worker:', error);
            showNotification('Error en el proceso de reconstrucción', 'error');
            isProcessing = false;
        };
        
        // Inicializar worker
        const metadata = shumzuDecoder.metadata;
        currentWorker.postMessage({
            type: 'init',
            data: {
                metadata: metadata,
                isEncrypted: shumzuDecoder.isEncrypted,
                password: null // Se pedirá si es necesario
            }
        });
        
        // Enviar bloques al worker
        for (const [index, base64Data] of shumzuDecoder.qrData.entries()) {
            if (index > 0) { // Ignorar bloque 0 (metadatos)
                currentWorker.postMessage({
                    type: 'process-block',
                    data: {
                        index: index,
                        encodedData: base64Data
                    }
                });
            }
        }
        
        // Finalizar
        currentWorker.postMessage({ type: 'finalize' });
    }
    
    function updateReconstructionProgress(current, total) {
        const percent = total > 0 ? Math.round((current / total) * 100) : 0;
        document.getElementById('reconstruction-progress-fill').style.width = `${percent}%`;
        document.getElementById('blocks-info').textContent = `${current}/${total} bloques`;
        document.getElementById('data-size').textContent = formatBytes(shumzuDecoder.metadata?.s || 0);
    }
    
    async function handleReconstructionResult(data) {
        isProcessing = false;
        
        if (currentWorker) {
            currentWorker.terminate();
            currentWorker = null;
        }
        
        if (data.hashMatches) {
            showNotification('✅ Archivo reconstruido exitosamente', 'success');
            
            // Descargar archivo
            downloadFile(data.decompressedData, shumzuDecoder.metadata.n || 'reconstructed_file');
            
            // Agregar al historial
            addToHistory({
                name: shumzuDecoder.metadata.n || 'Archivo reconstruido',
                size: data.decompressedData.length,
                type: 'scan',
                data: data.decompressedData,
                timestamp: Date.now()
            });
            
        } else {
            showNotification('⚠️ Archivo reconstruido pero el hash no coincide', 'warning');
        }
        
        // Mostrar estadísticas
        document.getElementById('error-correction-status').textContent = 
            `Recuperados: ${data.recoveredBlocks}/${data.totalBlocks}`;
    }
    
    function cancelReconstruction() {
        if (currentWorker) {
            currentWorker.terminate();
            currentWorker = null;
        }
        
        isProcessing = false;
        document.getElementById('reconstruction-progress-container').style.display = 'none';
        showNotification('Reconstrucción cancelada', 'info');
    }
    
    // ==================== FUNCIONES AUXILIARES ====================
    function showScanFeedback(message) {
        const feedback = document.getElementById('scan-feedback');
        feedback.textContent = message;
        feedback.style.display = 'block';
        
        setTimeout(() => {
            feedback.style.display = 'none';
        }, 2000);
    }
    
    function showNotification(message, type = 'info') {
        // Crear elemento de notificación
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.innerHTML = `
            <div class="notification-icon">${type === 'success' ? '✅' : type === 'error' ? '❌' : type === 'warning' ? '⚠️' : 'ℹ️'}</div>
            <div class="notification-content">${message}</div>
            <button class="notification-close" onclick="this.parentElement.remove()">&times;</button>
        `;
        
        // Agregar al documento
        document.body.appendChild(notification);
        
        // Auto-eliminar después de 5 segundos
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 5000);
    }
    
    function formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
    
    async function calculateSHA256(data) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
    
    function downloadFile(data, filename) {
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
    
    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('shumzu_theme', newTheme);
        updateThemeIcon(newTheme);
    }
    
    function updateThemeIcon(theme) {
        const toggle = document.getElementById('theme-toggle');
        toggle.textContent = theme === 'light' ? '🌙' : '☀️';
    }
    
    function togglePasswordVisibility(inputId) {
        const input = document.getElementById(inputId);
        const button = document.querySelector(`[onclick*="${inputId}"]`);
        
        if (input.type === 'password') {
            input.type = 'text';
            button.textContent = '👁️‍🗨️';
        } else {
            input.type = 'password';
            button.textContent = '👁️';
        }
    }
    
    function pauseScanning() {
        isScanning = false;
        document.getElementById('pause-scan').style.display = 'none';
        document.getElementById('resume-scan').style.display = 'inline-block';
    }
    
    function resumeScanning() {
        isScanning = true;
        document.getElementById('pause-scan').style.display = 'inline-block';
        document.getElementById('resume-scan').style.display = 'none';
        startQRScanning();
    }
    
    function closeCameraModal() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        
        if (animationFrame) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        }
        
        if (scanningInterval) {
            clearInterval(scanningInterval);
            scanningInterval = null;
        }
        
        isScanning = false;
        document.getElementById('camera-modal').style.display = 'none';
    }
    
    function saveScanProgress() {
        const progress = {
            metadata: shumzuDecoder.metadata,
            blocks: Array.from(shumzuDecoder.qrData.entries()),
            timestamp: Date.now()
        };
        
        localStorage.setItem('shumzu_scan_progress', JSON.stringify(progress));
        showNotification('Progreso guardado', 'success');
    }
    
    function showMetadataModal() {
        if (!shumzuDecoder.metadata) {
            showNotification('No hay metadatos para mostrar', 'warning');
            return;
        }
        
        const modal = document.getElementById('metadata-modal');
        const content = document.getElementById('metadata-content');
        const metadata = shumzuDecoder.metadata;
        
        let html = '<div class="metadata-grid">';
        for (const [key, value] of Object.entries(metadata)) {
            html += `
                <div class="metadata-item">
                    <strong>${key}:</strong>
                    <span>${typeof value === 'object' ? JSON.stringify(value) : value}</span>
                </div>
            `;
        }
        html += '</div>';
        
        content.innerHTML = html;
        modal.style.display = 'flex';
    }
    
    function closeMetadataModal() {
        document.getElementById('metadata-modal').style.display = 'none';
    }
    
    function showPasswordModal() {
        document.getElementById('password-modal').style.display = 'flex';
    }
    
    function closePasswordModal() {
        document.getElementById('password-modal').style.display = 'none';
        document.getElementById('password-input').value = '';
    }
    
    function confirmPassword() {
        const password = document.getElementById('password-input').value;
        if (!password) {
            showNotification('Por favor ingresa la contraseña', 'warning');
            return;
        }
        
        // Aquí implementarías la lógica de descifrado
        showNotification('Contraseña verificada', 'success');
        closePasswordModal();
    }
    
    function addToHistory(item) {
        scanHistory.unshift(item);
        if (scanHistory.length > 50) {
            scanHistory = scanHistory.slice(0, 50);
        }
        localStorage.setItem('shumzu_history', JSON.stringify(scanHistory));
        loadHistory();
    }
    
    function filterHistory(type) {
        const buttons = document.querySelectorAll('.filter-btn');
        buttons.forEach(btn => btn.classList.remove('active'));
        
        const historyList = document.getElementById('history-list');
        
        if (scanHistory.length === 0) {
            historyList.innerHTML = '<p class="no-history">No hay actividad reciente</p>';
            return;
        }
        
        let filtered = scanHistory;
        if (type === 'scans') {
            filtered = scanHistory.filter(item => item.type === 'scan');
        } else if (type === 'generations') {
            filtered = scanHistory.filter(item => item.type === 'generation');
        }
        
        document.getElementById(`filter-${type}`).classList.add('active');
        
        if (filtered.length === 0) {
            historyList.innerHTML = `<p class="no-history">No hay ${type === 'scans' ? 'escaneos' : 'generaciones'} en el historial</p>`;
            return;
        }
        
        historyList.innerHTML = '';
        filtered.slice(0, 10).forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            historyItem.innerHTML = `
                <div class="history-info">
                    <div class="history-name">${item.name || 'Archivo'}</div>
                    <div class="history-details">
                        ${formatBytes(item.size)} • ${new Date(item.timestamp).toLocaleDateString()} • ${item.type === 'scan' ? '📱 Escaneado' : '⚡ Generado'}
                    </div>
                </div>
                <button class="download-btn" onclick="window.downloadFile(${JSON.stringify(item.data)}, '${item.name}')">
                    ⬇️ Descargar
                </button>
            `;
            historyList.appendChild(historyItem);
        });
    }
    
    function exportScanData() {
        if (!shumzuDecoder.metadata) {
            showNotification('No hay datos para exportar', 'warning');
            return;
        }
        
        const exportData = {
            metadata: shumzuDecoder.metadata,
            blocks: Array.from(shumzuDecoder.qrData.entries()),
            timestamp: Date.now(),
            version: 'SHUMZU+ Export'
        };
        
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shumzu_scan_${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showNotification('Datos exportados exitosamente', 'success');
    }
    
    // ==================== INICIALIZAR APLICACIÓN ====================
    switchMode('scan');
    
    // Hacer funciones globales para uso en HTML
    window.downloadFile = downloadFile;
    window.showNotification = showNotification;
});
