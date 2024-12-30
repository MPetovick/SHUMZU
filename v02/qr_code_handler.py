import base64
import json
import logging
import qrcode
from PIL import Image
from pyzbar.pyzbar import decode
from exceptions import QRCodeError
from blockchain import Blockchain
import zstandard as zstd
import os

Image.MAX_IMAGE_PIXELS = None

class QRCodeHandler:

    @staticmethod
    def generate_qr_code(data, block_number, hash_value, secret_key, file_name=None, file_extension=None, qr_size=(300, 300)):
        try:
            # Preparar el JSON con los datos del bloque
            qr_data = {
                'data': base64.b64encode(data).decode('utf-8'),
                'hash': hash_value,
                'block_number': block_number,
            }
            if file_name and block_number == 0:
                qr_data['file_name'] = file_name
            if file_extension and block_number == 0:
                qr_data['file_extension'] = file_extension

            qr_json = json.dumps(qr_data)
            qr = qrcode.QRCode(version=5, error_correction=qrcode.constants.ERROR_CORRECT_L, box_size=10, border=4)
            qr.add_data(qr_json)
            qr.make(fit=True)
            img = qr.make_image(fill='black', back_color='white').resize(qr_size)

            # Retornar los datos de la imagen y los metadatos
            return {'image': img, 'block_number': block_number, 'hash': hash_value}
        except Exception as e:
            logging.error(f"Error al generar el QR para el bloque {block_number}: {e}")
            raise QRCodeError(f"Error al generar el QR para el bloque {block_number}.")

    @staticmethod
    def validate_qr_images(qr_images, min_size=(100, 100)):
        try:
            if not qr_images:
                raise ValueError("No hay imágenes QR válidas para procesar.")
            
            base_size = qr_images[0]['image'].size  # Usamos 'image' del diccionario retornado
            if any(img['image'].size != base_size for img in qr_images):  # Comprobamos que todas tengan el mismo tamaño
                raise ValueError("Las dimensiones de las imágenes QR no son consistentes.")
            
            for img in qr_images:
                if img['image'].size[0] < min_size[0] or img['image'].size[1] < min_size[1]:  # Ajustar tamaño mínimo
                    raise ValueError(f"El tamaño de la imagen QR {img['image'].size} es demasiado pequeño.")
            
            return qr_images
        except Exception as e:
            logging.error(f"Error al validar imágenes QR: {e}")
            raise QRCodeError("Error al validar imágenes QR.")

    @staticmethod
    def decode_qr_matrix(keymaster_path):
        try:
            image = Image.open(keymaster_path)
            qr_codes = decode(image)

            if not qr_codes:
                raise QRCodeError("No se detectaron códigos QR en la matriz proporcionada.")

            decoded_data = []
            file_name = file_extension = None

            for idx, qr_code in enumerate(qr_codes):
                try:
                    qr_data_raw = qr_code.data.decode('utf-8')

                    qr_json = json.loads(qr_data_raw)

                    required_keys = ('data', 'hash', 'block_number')
                    if not all(key in qr_json for key in required_keys):
                        raise ValueError(f"El QR en la posición {idx} no tiene las claves requeridas: {qr_data_raw}")

                    decoded_block_data = base64.b64decode(qr_json['data'])

                    calculated_hash = Blockchain.hash_block(decoded_block_data)
                    if calculated_hash != qr_json['hash']:
                        raise ValueError(f"Hash inválido en el QR de la posición {idx}. Calculado: {calculated_hash}, Esperado: {qr_json['hash']}.")

                    if 'file_name' in qr_json and not file_name:
                        file_name = qr_json['file_name']
                    if 'file_extension' in qr_json and not file_extension:
                        file_extension = qr_json['file_extension']

                    # Agregar datos decodificados a la lista
                    decoded_data.append({
                        'data': decoded_block_data,
                        'hash': qr_json['hash'],
                        'block_number': qr_json['block_number']
                    })

                except Exception as block_error:
                    logging.error(f"Error al procesar el QR en la posición {idx}: {block_error}")
                    raise ValueError(f"Error al procesar el QR en la posición {idx}: {block_error}")

            if not decoded_data:
                raise QRCodeError("No se pudieron decodificar datos válidos desde la matriz QR.")

            if not file_name or not file_extension:
                raise QRCodeError("Faltan metadatos del archivo (nombre o extensión) en los códigos QR.")

            decoded_data.sort(key=lambda x: x['block_number'])

            logging.info(f"Decodificados {len(decoded_data)} bloques QR con éxito.")
            return decoded_data, file_name, file_extension

        except QRCodeError as qr_err:
            logging.error(f"Error en la decodificación de la matriz QR: {qr_err}")
            raise
        except Exception as e:
            logging.error(f"Error inesperado al decodificar la matriz QR desde '{keymaster_path}': {e}")
            raise QRCodeError("Error al decodificar la matriz QR.") from e

    @staticmethod
    def decompress_data(data):
        """Descomprime los datos usando el algoritmo Zstd."""
        decompressor = zstd.ZstdDecompressor()
        try:
            return decompressor.decompress(data)
        except zstd.ZstdError as e:
            logging.error(f"Error al descomprimir los datos: {e}")
            # Intentar alguna acción correctiva, como reintentar o alertar sobre el error
            return None  # Devuelve None si la descompresión falla
        except Exception as e:
            logging.error(f"Error inesperado al descomprimir los datos: {e}")
            return None
    
    @staticmethod
    def calculate_dynamic_block_size(file_size, target_blocks=100, max_qr_size=3000):
        """Calcula el tamaño dinámico del bloque en función del tamaño del archivo y los parámetros."""
        # Asegurarse de que target_blocks sea un entero
        target_blocks = int(target_blocks)  # Convertir target_blocks a entero si es una cadena
        block_size = file_size // target_blocks
        block_size = min(block_size, max_qr_size)
        block_size = max(block_size, 1024)
        logging.info(f"El tamaño dinámico del bloque es: {block_size} bytes")
        return block_size

    @staticmethod
    def reconstruct_file(decoded_data, file_name=None, file_extension=""):
        """Reconstruye un archivo a partir de los datos decodificados."""
        try:
            if not decoded_data:
                raise ValueError("No hay datos para reconstruir el archivo.")

            base_name = os.path.splitext(file_name)[0] if file_name else "archivo_recuperado"
            output_file = os.path.join(os.getcwd(), f"{base_name}_SHUMZU{file_extension}")

            total_data = b""

            for idx, block in enumerate(decoded_data):
                # Intentar descomprimir cada bloque y verificar si es válido
                decompressed_data = QRCodeHandler.decompress_data(block['data'])
                if decompressed_data is None:
                    raise ValueError(f"Error al descomprimir el bloque {block['block_number']}.")

                total_data += decompressed_data
                logging.debug(f"Bloque {idx + 1} añadido, tamaño: {len(block['data'])} bytes.")

            with open(output_file, 'wb') as file:
                file.write(total_data)

            logging.info(f"Archivo reconstruido guardado en: {output_file}")
        
        except Exception as e:
            logging.error(f"Error al reconstruir el archivo: {e}")
            raise ValueError("Error al reconstruir el archivo.") from e
