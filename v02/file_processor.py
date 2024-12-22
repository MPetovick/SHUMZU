import os
import base64
import logging
from PIL import Image
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from exceptions import FileProcessingError

Image.MAX_IMAGE_PIXELS = None  # Deshabilitar la protección de bombas de descompresión

class FileProcessor:
    @staticmethod
    def calculate_dynamic_block_size(file_path, target_blocks=100, max_qr_size=3000):
        file_size = os.path.getsize(file_path)
        block_size = file_size // target_blocks
        block_size = min(block_size, max_qr_size)
        block_size = max(block_size, 1024)
        logging.info(f"El tamaño dinámico del bloque es: {block_size} bytes")
        return block_size
        
    @staticmethod
    def split_data_into_qr_blocks(data, file_path=None, file_name=None, file_extension=None, target_blocks=100, max_qr_size=3000):
        
        if file_path:
            block_size = FileProcessor.calculate_dynamic_block_size(file_path, target_blocks, max_qr_size)
        else:
            block_size = 1024

        blocks = [{'data': data[i:i + block_size]} for i in range(0, len(data), block_size)]

        if not blocks:
            raise ValueError("No se generaron bloques. Verifique el tamaño de los datos o el tamaño del bloque.")

        if len(blocks) > 0 and file_name:
            blocks[1]['file_name'] = file_name
        if len(blocks) > 0 and file_extension:
            blocks[0]['file_extension'] = file_extension

        logging.info(f"Se generaron {len(blocks)} bloques de datos.")
        return blocks

    @staticmethod
    def read_file_in_chunks(file_path, chunk_size=1024 * 1024):
        try:
            with open(file_path, 'rb') as file:
                while chunk := file.read(chunk_size):
                    yield chunk
        except Exception as e:
            logging.error(f"Error al leer el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al leer el archivo.")

    @staticmethod
    def create_qr_matrix(qr_images, output_path, qr_size=(300, 300)):
        try:
            columns = int(len(qr_images) ** 0.5)
            rows = (len(qr_images) + columns - 1) // columns

            qr_width, qr_height = qr_size
            matrix_image = Image.new('RGB', (qr_width * columns, qr_height * rows))

            for idx, img in enumerate(qr_images):
                row, col = divmod(idx, columns)
                matrix_image.paste(img, (col * qr_width, row * qr_height))

            matrix_image.save(output_path)
            logging.info(f"Matriz QR guardada en '{output_path}'.")
        except Exception as e:
            logging.error(f"Error al crear la matriz QR: {e}")
            raise FileProcessingError("Error al crear la matriz QR.")

    @staticmethod
    def reconstruct_file(decoded_data, file_name=None, file_extension=""):
 
        try:
            # Validar que hay bloques
            if not decoded_data:
                raise ValueError("No hay datos para reconstruir el archivo.")

            base_name = os.path.splitext(file_name)[0] if file_name else "archivo_recuperado"
            output_file = os.path.join(os.getcwd(), f"{base_name}{file_extension}")  # Usar la extensión si se proporciona

            total_data = b""

            for idx, block in enumerate(decoded_data):
                total_data += block['data']
                logging.debug(f"Bloque {idx + 1} añadido, tamaño: {len(block['data'])} bytes.")

            with open(output_file, 'wb') as file:
                file.write(total_data)

            logging.info(f"Archivo reconstruido guardado en: {output_file}")
        
        except Exception as e:
            logging.error(f"Error al reconstruir el archivo: {e}")
            raise ValueError("Error al reconstruir el archivo.") from e

    @staticmethod
    def encrypt_file(file_path, secret_key, output_path=None):
     
        try:
            iv = os.urandom(16)
            cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
            encryptor = cipher.encryptor()

            if not output_path:
                output_path = f"{file_path}.enc"
            
            with open(file_path, 'rb') as input_file, open(output_path, 'wb') as output_file:
                output_file.write(iv)
                
                while chunk := input_file.read(2048 * 2048):
                    encrypted_chunk = encryptor.update(chunk)
                    output_file.write(encrypted_chunk)
            
            logging.info(f"Archivo cifrado guardado en '{output_path}'")
            return output_path
        except Exception as e:
            logging.error(f"Error al cifrar el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al cifrar el archivo.")

    @staticmethod
    def decrypt_file(file_path, secret_key, output_path=None):

        try:
            with open(file_path, 'rb') as input_file:
                iv = input_file.read(16)
                cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                
                if not output_path:
                    output_path = file_path.replace('.enc', '.dec')
                
                with open(output_path, 'wb') as output_file:
                    while chunk := input_file.read(1024 * 1024):  # Bloques de 1 MB
                        decrypted_chunk = decryptor.update(chunk)
                        output_file.write(decrypted_chunk)
            
            logging.info(f"Archivo descifrado guardado en '{output_path}'")
            return output_path
        except Exception as e:
            logging.error(f"Error al descifrar el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al descifrar el archivo.")
