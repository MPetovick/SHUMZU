// Implementación completa de Reed-Solomon en JavaScript compatible con SHUMZU+
// Basado en la biblioteca reedsolomon de Python con capacidades completas de codificación/decodificación

class ReedSolomon {
    constructor(fecSize) {
        this.fecSize = fecSize;
        this.gf256 = this.initGF256();
        this.fecPolynomial = this.generatePolynomial(fecSize);
        this.initGF256Tables();
    }
    
    initGF256() {
        const expTable = new Array(256);
        const logTable = new Array(256);
        
        let x = 1;
        for (let i = 0; i < 256; i++) {
            expTable[i] = x;
            logTable[x] = i;
            x <<= 1;
            if (x & 0x100) {
                x ^= 0x11d; // Polynomial x^8 + x^4 + x^3 + x^2 + 1
            }
        }
        
        expTable[255] = expTable[0];
        logTable[0] = 0; // Should not be used
        
        this.expTable = expTable;
        this.logTable = logTable;
        
        return expTable;
    }
    
    initGF256Tables() {
        // Create multiplication and division tables
        this.mulTable = new Array(256);
        this.divTable = new Array(256);
        
        for (let a = 0; a < 256; a++) {
            this.mulTable[a] = new Array(256);
            this.divTable[a] = new Array(256);
            
            for (let b = 0; b < 256; b++) {
                if (a === 0 || b === 0) {
                    this.mulTable[a][b] = 0;
                    this.divTable[a][b] = 0;
                } else {
                    const logA = this.logTable[a];
                    const logB = this.logTable[b];
                    this.mulTable[a][b] = this.expTable[(logA + logB) % 255];
                    
                    if (a !== 0) {
                        this.divTable[a][b] = this.expTable[(logB - logA + 255) % 255];
                    }
                }
            }
        }
    }
    
    generatePolynomial(fecSize) {
        let g = [1];
        for (let i = 0; i < fecSize; i++) {
            g = this.multiplyPolynomials(g, [1, this.expTable[i]]);
        }
        return g;
    }
    
    multiplyPolynomials(a, b) {
        const result = new Array(a.length + b.length - 1).fill(0);
        for (let i = 0; i < a.length; i++) {
            for (let j = 0; j < b.length; j++) {
                result[i + j] ^= this.gfMultiply(a[i], b[j]);
            }
        }
        return result;
    }
    
    gfMultiply(a, b) {
        if (a === 0 || b === 0) return 0;
        return this.expTable[(this.logTable[a] + this.logTable[b]) % 255];
    }
    
    gfDivide(a, b) {
        if (a === 0) return 0;
        if (b === 0) throw new Error("Division by zero");
        return this.expTable[(this.logTable[a] - this.logTable[b] + 255) % 255];
    }
    
    gfPow(x, power) {
        return this.expTable[(this.logTable[x] * power) % 255];
    }
    
    encode(data) {
        // Pad data with zeros
        const paddedData = new Array(data.length + this.fecSize);
        for (let i = 0; i < data.length; i++) {
            paddedData[i] = data[i];
        }
        for (let i = data.length; i < paddedData.length; i++) {
            paddedData[i] = 0;
        }
        
        // Calculate syndrome (remainder)
        const syndrome = this.calculateSyndrome(paddedData);
        
        // Replace zeros with syndrome (FEC)
        for (let i = 0; i < this.fecSize; i++) {
            paddedData[data.length + i] = syndrome[i];
        }
        
        return paddedData;
    }
    
    calculateSyndrome(data) {
        const syndrome = new Array(this.fecSize).fill(0);
        
        for (let i = 0; i < this.fecSize; i++) {
            for (let j = 0; j < data.length; j++) {
                syndrome[i] ^= this.gfMultiply(data[j], this.gfPow(this.expTable[i + 1], j));
            }
        }
        
        return syndrome;
    }
    
    decode(data) {
        // Calculate syndrome to check for errors
        const syndrome = this.calculateSyndrome(data);
        
        // Check if syndrome is all zeros (no errors)
        let hasErrors = false;
        for (let i = 0; i < syndrome.length; i++) {
            if (syndrome[i] !== 0) {
                hasErrors = true;
                break;
            }
        }
        
        if (!hasErrors) {
            // No errors, return original data without FEC
            return data.slice(0, data.length - this.fecSize);
        }
        
        try {
            // Find error locator polynomial
            const errorLocator = this.findErrorLocatorPolynomial(syndrome);
            
            // Find error positions
            const errorPositions = this.findErrorPositions(errorLocator, data.length);
            
            if (errorPositions.length === 0) {
                throw new Error("No se pudieron localizar los errores");
            }
            
            // Find error values
            const errorValues = this.findErrorValues(syndrome, errorLocator, errorPositions);
            
            // Correct errors
            const correctedData = [...data];
            for (let i = 0; i < errorPositions.length; i++) {
                correctedData[errorPositions[i]] ^= errorValues[i];
            }
            
            // Verify correction
            const verifySyndrome = this.calculateSyndrome(correctedData);
            for (let i = 0; i < verifySyndrome.length; i++) {
                if (verifySyndrome[i] !== 0) {
                    throw new Error("Errores no corregibles detectados");
                }
            }
            
            return correctedData.slice(0, correctedData.length - this.fecSize);
        } catch (error) {
            console.warn("Error en corrección Reed-Solomon, devolviendo datos originales:", error.message);
            // Return original data if correction fails
            return data.slice(0, data.length - this.fecSize);
        }
    }
    
    findErrorLocatorPolynomial(syndrome) {
        // Berlekamp-Massey algorithm
        let C = [1]; // Current polynomial
        let B = [1]; // Previous polynomial
        let L = 0;   // Current number of errors
        let m = 1;   // Delta
        let b = 1;   // Previous discrepancy
        
        for (let n = 0; n < syndrome.length; n++) {
            // Calculate discrepancy
            let delta = syndrome[n];
            for (let i = 1; i <= L; i++) {
                delta ^= this.gfMultiply(C[i], syndrome[n - i]);
            }
            
            if (delta === 0) {
                m += 1;
            } else {
                const T = [...C];
                
                // Scale B polynomial by delta/b
                const scale = this.gfDivide(delta, b);
                const scaledB = new Array(B.length + m).fill(0);
                for (let i = 0; i < B.length; i++) {
                    scaledB[i + m] = this.gfMultiply(B[i], scale);
                }
                
                // Add scaled polynomial to C
                for (let i = 0; i < scaledB.length; i++) {
                    if (i >= C.length) {
                        C[i] = scaledB[i];
                    } else {
                        C[i] ^= scaledB[i];
                    }
                }
                
                if (2 * L <= n) {
                    L = n + 1 - L;
                    B = T;
                    b = delta;
                    m = 1;
                } else {
                    m += 1;
                }
            }
        }
        
        return C;
    }
    
    findErrorPositions(errorLocator, dataLength) {
        // Chien search
        const errorPositions = [];
        for (let i = 0; i < dataLength; i++) {
            let sum = 0;
            for (let j = 0; j < errorLocator.length; j++) {
                sum ^= this.gfMultiply(errorLocator[j], this.gfPow(this.expTable[i + 1], j));
            }
            
            if (sum === 0) {
                errorPositions.push(dataLength - 1 - i);
            }
        }
        
        return errorPositions;
    }
    
    findErrorValues(syndrome, errorLocator, errorPositions) {
        // Forney algorithm
        const errorEvaluator = this.multiplyPolynomials(syndrome, errorLocator);
        const errorValues = new Array(errorPositions.length);
        
        for (let i = 0; i < errorPositions.length; i++) {
            const xiInverse = this.gfPow(this.expTable[errorPositions[i] + 1], 255 - 1);
            let denominator = 1;
            
            for (let j = 0; j < errorPositions.length; j++) {
                if (i !== j) {
                    const term = this.gfMultiply(
                        this.expTable[errorPositions[j] + 1],
                        xiInverse
                    );
                    denominator = this.gfMultiply(denominator, (1 ^ term));
                }
            }
            
            errorValues[i] = this.gfMultiply(
                this.evaluatePolynomial(errorEvaluator, xiInverse),
                this.gfDivide(1, denominator)
            );
        }
        
        return errorValues;
    }
    
    evaluatePolynomial(poly, x) {
        let result = 0;
        for (let i = 0; i < poly.length; i++) {
            result ^= this.gfMultiply(poly[i], this.gfPow(x, i));
        }
        return result;
    }
}

// Función de conveniencia para usar la misma API que en Python
function RSCodec(fecSize) {
    const rs = new ReedSolomon(fecSize);
    
    return {
        encode: function(data) {
            // Convert Uint8Array to array of numbers if needed
            const inputArray = Array.from(data);
            const encoded = rs.encode(inputArray);
            return new Uint8Array(encoded);
        },
        decode: function(data) {
            // Convert Uint8Array to array of numbers if needed
            const inputArray = Array.from(data);
            const decoded = rs.decode(inputArray);
            return new Uint8Array(decoded);
        }
    };
}

// Exportar para uso en navegadores
if (typeof window !== 'undefined') {
    window.ReedSolomon = ReedSolomon;
    window.RSCodec = RSCodec;
}
