"""
░██████╗██╗░░██╗██╗░░░██╗███╗░░░███╗███████╗██╗░░░██╗
██╔════╝██║░░██║██║░░░██║████╗░████║╚════██║██║░░░██║
╚█████╗░███████║██║░░░██║██╔████╔██║░░███╔═╝██║░░░██║
░╚═══██╗██╔══██║██║░░░██║██║╚██╔╝██║██╔══╝░░██║░░░██║
██████╔╝██║░░██║╚██████╔╝██║░╚═╝░██║███████╗╚██████╔╝
╚═════╝░╚═╝░░╚═╝░╚═════╝░╚═╝░░░░░╚═╝╚══════╝░╚═════╝░
                                     by MikePetovick

Secure storage, transmission and reconstruction
2024-12-15 15:00:33
"""

import argparse
import os
import logging
import secrets
import string
from pyzbar.pyzbar import decode
from PIL import Image
from hashlib import sha3_256
from fpdf import FPDF
from datetime import datetime

# Configurar el logging para que sea más útil
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def get_qr_hash(image_path):
    """Lee la imagen, decodifica los códigos QR y devuelve sus hashes SHA3-256."""
    if not os.path.exists(image_path):
        logging.error(f"El archivo {image_path} no existe.")
        return None

    try:
        # Abrir la imagen
        image = Image.open(image_path)
    except Exception as e:
        logging.error(f"Error al abrir la imagen: {e}")
        return None

    # Decodificar los códigos QR en la imagen
    decoded_objects = decode(image)

    if not decoded_objects:
        logging.warning("No se encontraron códigos QR en la imagen.")
        return None

    hashes = []
    for obj in decoded_objects:
        qr_content = obj.data.decode("utf-8")
        logging.info(f"Contenido del QR: {qr_content}")

        # Generar el hash SHA3-256 del contenido
        qr_hash = sha3_256(qr_content.encode()).hexdigest()
        hashes.append((qr_content, qr_hash))
    
    return hashes

def generate_strong_password(length=16):
    """Genera una contraseña aleatoria segura (no se usa en este caso)."""
    alphabet = string.ascii_letters + string.digits + string.punctuation
    return ''.join(secrets.choice(alphabet) for _ in range(length))

def create_pdf(data, image_path, output_pdf_path):
    """Genera un PDF con la información de los códigos QR, sus hashes y la imagen QR."""
    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()

    # Establecer título y estilo de la fuente
    pdf.set_font("Arial", size=16, style='B')
    pdf.cell(200, 10, txt="Ficha Técnica de los Códigos QR", ln=True, align="C")
    pdf.ln(10)  # Salto de línea

    # Establecer fuente para el contenido
    pdf.set_font("Arial", size=12)

    # Añadir la tabla de hashes
    pdf.set_font("Arial", size=12, style='B')
    pdf.cell(90, 10, txt="Contenido del QR", border=1, align="C")
    pdf.cell(90, 10, txt="Hash SHA3-256", border=1, align="C")
    pdf.ln()

    pdf.set_font("Arial", size=10)
    for content, qr_hash in data:
        pdf.cell(90, 10, txt=content[:40], border=1, align="C")  # Mostrar solo primeros 40 caracteres
        pdf.cell(90, 10, txt=qr_hash[:40], border=1, align="C")  # Mostrar solo primeros 40 caracteres
        pdf.ln()

    pdf.ln(10)  # Salto de línea para separar la tabla de la imagen

    # Establecer fuente para la imagen
    pdf.set_font("Arial", size=12)
    pdf.cell(200, 10, txt="Imagen del QR:", ln=True)
    pdf.ln(5)

    # Ajustar la imagen QR al tamaño del PDF
    try:
        pdf.image(image_path, x=10, y=pdf.get_y(), w=100)  # Ajustar el tamaño de la imagen
        pdf.ln(110)  # Ajuste para evitar que se superponga
    except Exception as e:
        logging.error(f"Error al agregar la imagen: {e}")
        pdf.ln(10)  # Deja espacio si no se puede agregar la imagen

    # Añadir pie de página con la fecha de creación
    pdf.set_y(-15)
    pdf.set_font("Arial", "I", 8)
    pdf.cell(0, 10, txt=f"Generado el: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}", align="C")

    # Guardar el PDF
    pdf.output(output_pdf_path)
    logging.info(f"PDF generado con éxito: {output_pdf_path}")

def main():
    """Configuración de la línea de comandos y ejecución principal."""
    parser = argparse.ArgumentParser(description="Leer un código QR de una imagen y obtener su hash SHA3-256.")
    
    # Argumento para la ruta de la imagen
    parser.add_argument("-i", "--image", type=str, required=True, help="Ruta de la imagen que contiene el código QR.")

    # Parsear los argumentos
    args = parser.parse_args()

    # Obtener el hash del código QR
    qr_hashes = get_qr_hash(args.image)

    if qr_hashes:
        # Generar un nombre de archivo único basado en la fecha y hora
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        pdf_filename = f"qr_hashes_{timestamp}.pdf"

        # Crear el PDF sin protección primero
        create_pdf(qr_hashes, args.image, pdf_filename)

        logging.info(f"Ficha técnica generada correctamente en {pdf_filename}")

    else:
        logging.warning("No se generaron hashes, asegúrate de que la imagen contiene un código QR válido.")

if __name__ == "__main__":
    main()
