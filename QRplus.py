import numpy as np
import matplotlib.pyplot as plt
import random

# Función para convertir el texto en binario
def text_to_binary(data):
    """Convierte el texto a una cadena de bits binarios."""
    return ''.join(format(ord(char), '08b') for char in data)

# Función para generar el QRplus con un patrón espiral
def generate_qrplus(data, resolution=500):
    """Genera el QRplus con un patrón espiral y colores."""
    # Convertimos los datos a binarios
    binary_data = text_to_binary(data)
    
    # Crear una imagen vacía (de 3 canales para colores)
    qrplus = np.zeros((resolution, resolution, 3), dtype=int)
    
    # Definir los colores posibles (16 colores diferentes)
    colors = [
        [255, 0, 0],    # Rojo
        [0, 255, 0],    # Verde
        [0, 0, 255],    # Azul
        [255, 255, 0],  # Amarillo
        [255, 0, 255],  # Magenta
        [0, 255, 255],  # Cian
        [255, 128, 0],  # Naranja
        [128, 0, 255],  # Púrpura
        [255, 255, 255],# Blanco
        [128, 128, 128],# Gris
        [0, 0, 0],      # Negro
        [128, 255, 0],  # Verde Claro
        [0, 128, 255],  # Azul Claro
        [255, 0, 128],  # Rosa
        [128, 255, 255],# Cian Claro
        [255, 128, 255] # Magenta Claro
    ]
    
    # Definir el centro de la espiral
    x, y = resolution // 2, resolution // 2
    dx, dy = 0, -1
    max_length = len(binary_data)
    
    step = resolution // (len(binary_data) ** 0.5)
    
    # Recorrer y llenar la espiral con los datos binarios y asignar colores
    for i in range(max_length):
        if i < len(binary_data):
            bit = int(binary_data[i])
            color_index = bit % len(colors)  # Elegir un color en función del bit
            qrplus[x, y] = colors[color_index]  # Asignar el color al píxel correspondiente
        
        # Cambiar dirección en la espiral
        if -resolution // 2 < x <= resolution // 2 and -resolution // 2 < y <= resolution // 2:
            if x == y or (x < 0 and x == -y) or (x > 0 and x == 1 - y):
                dx, dy = -dy, dx
            x, y = x + dx * step, y + dy * step

    # Mostrar el código QRplus
    plt.imshow(qrplus)
    plt.axis('off')  # Desactivar los ejes para una vista limpia
    plt.show()

# Función para decodificar un QRplus
def decode_qrplus(qrplus_image, resolution=500):
    """Decodifica el QRplus a su texto original a partir de la imagen generada."""
    # Obtener los colores del código QRplus
    height, width, _ = qrplus_image.shape
    decoded_bits = []
    
    # Definir los colores y sus valores binarios
    color_to_bin = {
        (255, 0, 0): '0',    # Rojo
        (0, 255, 0): '1',    # Verde
        (0, 0, 255): '2',    # Azul
        (255, 255, 0): '3',  # Amarillo
        (255, 0, 255): '4',  # Magenta
        (0, 255, 255): '5',  # Cian
        (255, 128, 0): '6',  # Naranja
        (128, 0, 255): '7',  # Púrpura
        (255, 255, 255): '8',# Blanco
        (128, 128, 128): '9',# Gris
        (0, 0, 0): 'A',      # Negro
        (128, 255, 0): 'B',  # Verde Claro
        (0, 128, 255): 'C',  # Azul Claro
        (255, 0, 128): 'D',  # Rosa
        (128, 255, 255): 'E',# Cian Claro
        (255, 128, 255): 'F' # Magenta Claro
    }

    # Recorrer los píxeles del QRplus y extraer el valor de cada color
    for x in range(height):
        for y in range(width):
            pixel_color = tuple(qrplus_image[x, y])  # Obtener el color del píxel
            if pixel_color in color_to_bin:
                decoded_bits.append(color_to_bin[pixel_color])

    # Convertir los bits a texto (8 bits = 1 byte)
    binary_data = ''.join(decoded_bits)
    decoded_text = ''.join(chr(int(binary_data[i:i+8], 2)) for i in range(0, len(binary_data), 8))

    return decoded_text