import numpy as np
import matplotlib.pyplot as plt

# Definimos los 16 colores para representar 4 bits por píxel
color_map = {
    '0000': (1, 0, 0),    # Rojo
    '0001': (0, 1, 0),    # Verde
    '0010': (0, 0, 1),    # Azul
    '0011': (1, 1, 0),    # Amarillo
    '0100': (0.5, 0, 0),  # Rojo oscuro
    '0101': (0, 0.5, 0),  # Verde oscuro
    '0110': (0, 0, 0.5),  # Azul oscuro
    '0111': (0.5, 0.5, 0),# Amarillo oscuro
    '1000': (0.7, 0.7, 0),# Amarillo claro
    '1001': (0, 0.7, 0),  # Verde claro
    '1010': (0.7, 0, 0),  # Rojo claro
    '1011': (0, 0, 0.7),  # Azul claro
    '1100': (1, 0.5, 0),  # Naranja
    '1101': (0, 1, 1),    # Cian
    '1110': (1, 0, 1),    # Magenta
    '1111': (1, 1, 1),    # Blanco
}

# Invertir el diccionario para poder obtener el código binario de cada color
reverse_color_map = {v: k for k, v in color_map.items()}

def detect_pattern(qrplus_image, resolution):
    """
    Función para detectar el patrón del QRplus: espiral o circular.
    """
    # Revisar la simetría y la disposición de los píxeles.
    # Aquí implementaremos un simple chequeo basado en la forma de los píxeles.
    
    # Verificar si hay un patrón radial (circular)
    center = (resolution // 2, resolution // 2)
    radial_pattern = True
    
    # Comprobamos si los píxeles se distribuyen radialmente alrededor del centro
    for r in range(resolution // 4, resolution // 2):
        for angle in np.linspace(0, 360, 36):  # 36 puntos de prueba
            x = int(center[0] + r * np.cos(np.radians(angle)))
            y = int(center[1] + r * np.sin(np.radians(angle)))
            if np.all(qrplus_image[x, y] == 0):  # Verifica si el píxel está vacío
                radial_pattern = False
                break
        if not radial_pattern:
            break
    
    # Si encontramos una estructura radial, asumimos que es un patrón circular
    if radial_pattern:
        return "circular"
    else:
        # Si no, asumimos que es espiral
        return "spiral"

def decode_qrplus(qrplus_image, resolution=500):
    """
    Función optimizada para decodificar una imagen QRplus generada con colores.
    Detecta automáticamente si es espiral o circular, y maneja distorsiones.
    """
    # Detectar el tipo de patrón (espiral o circular)
    pattern_type = detect_pattern(qrplus_image, resolution)
    
    decoded_binary = []
    
    # Dependiendo del patrón detectado, ajustamos la lectura de la imagen
    if pattern_type == "spiral":
        decoded_binary = decode_spiral(qrplus_image, resolution)
    elif pattern_type == "circular":
        decoded_binary = decode_circular(qrplus_image, resolution)
    
    # Convertimos la lista de binarios en un string largo
    decoded_data = ''.join(decoded_binary)
    
    # Dividir la cadena binaria en bloques de 8 bits para obtener los caracteres
    decoded_text = ''.join(chr(int(decoded_data[i:i+8], 2)) for i in range(0, len(decoded_data), 8))
    
    return decoded_text

def decode_spiral(qrplus_image, resolution):
    """
    Decodifica una imagen QRplus en formato espiral.
    """
    decoded_binary = []
    x, y = resolution // 2, resolution // 2
    dx, dy = 0, -1
    step = resolution // (resolution ** 0.5)
    
    for i in range(resolution**2):  # Aproximación a la cantidad de píxeles
        # Obtener el color del píxel y convertir a binario
        color = tuple(qrplus_image[x, y])
        if color in reverse_color_map:
            decoded_binary.append(reverse_color_map[color])
        
        # Movimiento en espiral
        if (-resolution // 2 < x <= resolution // 2) and (-resolution // 2 < y <= resolution // 2):
            if x == y or (x < 0 and x == -y) or (x > 0 and x == 1 - y):
                dx, dy = -dy, dx
            x, y = x + dx * step, y + dy * step
    
    return decoded_binary

def decode_circular(qrplus_image, resolution):
    """
    Decodifica una imagen QRplus en formato circular.
    """
    decoded_binary = []
    center = (resolution // 2, resolution // 2)
    radius = resolution // 2
    
    for r in range(radius):
        for angle in np.linspace(0, 360, 36):  # 36 puntos de prueba
            x = int(center[0] + r * np.cos(np.radians(angle)))
            y = int(center[1] + r * np.sin(np.radians(angle)))
            # Obtener el color y decodificarlo
            color = tuple(qrplus_image[x, y])
            if color in reverse_color_map:
                decoded_binary.append(reverse_color_map[color])
    
    return decoded_binary

# Prueba de decodificación
# Aquí iría la imagen generada del QRplus (qrplus_image)
# decoded_message = decode_qrplus(qrplus_image)
# print("Mensaje decodificado:", decoded_message)