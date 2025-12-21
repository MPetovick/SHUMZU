// gif.worker.js - Worker optimizado para generación de GIF
self.importScripts('https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.js');

self.onmessage = function(e) {
    const { frames, width, height, quality, delay } = e.data;
    
    // Configurar GIF
    const gif = new GIF({
        workers: 2,
        quality: quality || 10,
        width: width || 300,
        height: height || 300,
        workerScript: 'https://cdnjs.cloudflare.com/ajax/libs/gif.js/0.2.0/gif.worker.js'
    });
    
    // Agregar frames
    frames.forEach((frameData, index) => {
        try {
            // Crear canvas temporal para el frame
            const canvas = new OffscreenCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            // Crear ImageData desde los datos del frame
            const imageData = new ImageData(new Uint8ClampedArray(frameData), width, height);
            ctx.putImageData(imageData, 0, 0);
            
            // Agregar frame al GIF
            gif.addFrame(canvas, { 
                delay: delay || 500,
                copy: true 
            });
            
            // Enviar progreso cada 5 frames
            if (index % 5 === 0) {
                const progress = Math.round((index / frames.length) * 100);
                self.postMessage({ 
                    type: 'progress', 
                    progress: progress 
                });
            }
        } catch (error) {
            console.warn(`Error procesando frame ${index}:`, error);
        }
    });
    
    // Evento cuando se termina de renderizar
    gif.on('finished', function(blob) {
        self.postMessage({ 
            type: 'finished', 
            blob: blob 
        });
    });
    
    // Iniciar renderizado
    gif.render();
};
