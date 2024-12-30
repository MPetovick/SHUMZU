import os
import base64
import logging
from PIL import Image
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from exceptions import FileProcessingError
import zstandard as zstd

# Definir un tamaño de fragmento estándar
DEFAULT_CHUNK_SIZE = 2 * 1024 * 1024  # 2 MB
Image.MAX_IMAGE_PIXELS = None  # Deshabilitar la protección de bombas de descompresión

class FileProcessor:
    @staticmethod
    def calculate_dynamic_block_size(file_size, target_blocks=100, max_qr_size=3000):
        """Calcula el tamaño dinámico del bloque en función del tamaño del archivo y los parámetros.

        Args:
            file_size (int): Tamaño del archivo en bytes.
            target_blocks (int): Número de bloques QR objetivo. Por defecto 100.
            max_qr_size (int): El tamaño máximo del bloque QR en bytes. Por defecto 3000 bytes.

        Returns:
            int: Tamaño del bloque en bytes.
        """
        try:
            # Asegurarse de que target_blocks sea un entero positivo
            target_blocks = int(target_blocks)  # Convertir target_blocks a entero si es una cadena
            if target_blocks <= 0:
                raise ValueError("El número de bloques objetivo debe ser mayor que cero.")

            # Verificar que file_size sea válido
            if file_size <= 0:
                raise ValueError("El tamaño del archivo debe ser mayor que cero.")
            
            # Calcular el tamaño base del bloque
            block_size = file_size // target_blocks
            
            # Asegurarse de que el tamaño del bloque esté dentro del rango permitido
            block_size = min(block_size, max_qr_size)  # No superar el tamaño máximo del QR
            block_size = max(block_size, 1024)         # Asegurar un tamaño mínimo para cada bloque (1024 bytes)

            logging.info(f"El tamaño dinámico del bloque calculado es: {block_size} bytes (Tamaño del archivo: {file_size} bytes, Bloques objetivo: {target_blocks}).")
            return block_size

        except ValueError as e:
            logging.error(f"Error al calcular el tamaño del bloque: {e}")
            raise
        except Exception as e:
            logging.error(f"Error inesperado al calcular el tamaño del bloque: {e}")
            raise

    @staticmethod
    def compress_data(data):
        """Comprime los datos usando el algoritmo Zstd."""
        compressor = zstd.ZstdCompressor()
        return compressor.compress(data)

    @staticmethod
    def decompress_data(data):
        """Descomprime los datos usando el algoritmo Zstd."""
        decompressor = zstd.ZstdDecompressor()
        try:
            return decompressor.decompress(data)
        except zstd.ZstdError as e:
            logging.error(f"Error al descomprimir los datos: {e}")
            return None  # Devuelve None si la descompresión falla
        except Exception as e:
            logging.error(f"Error inesperado al descomprimir los datos: {e}")
            return None

    @staticmethod
    def split_data_into_qr_blocks(data, file_name=None, file_extension=None, target_blocks=100, max_qr_size=3000):
        """Divide los datos en bloques adecuados para generar códigos QR."""
        # Asegurarse de que target_blocks sea un entero
        target_blocks = int(target_blocks)  # Convertir target_blocks a entero si es una cadena

        # Comprimir los datos antes de dividirlos
        compressed_data = FileProcessor.compress_data(data)

        block_size = FileProcessor.calculate_dynamic_block_size(len(compressed_data), target_blocks, max_qr_size)
        blocks = [{'data': compressed_data[i:i + block_size], 'block_number': idx}
                  for idx, i in enumerate(range(0, len(compressed_data), block_size))]

        if not blocks:
            raise ValueError("No se generaron bloques. Verifique el tamaño de los datos o el tamaño del bloque.")

        # Guardar metadatos en el primer bloque si existen
        if file_name:
            blocks[0]['file_name'] = file_name
        if file_extension:
            blocks[0]['file_extension'] = file_extension

        logging.info(f"Se generaron {len(blocks)} bloques de datos.")
        return blocks

    @staticmethod
    def calculate_dynamic_chunk_size(file_size, max_chunk_size=8 * 1024 * 1024, min_chunk_size=512 * 1024):
        """Ajusta dinámicamente el tamaño del fragmento en función del tamaño del archivo."""
        # Asegurarse de que file_size sea un entero
        file_size = int(file_size)  # Convertir file_size a entero si es una cadena

        # Si el archivo es muy pequeño, usa un tamaño de fragmento pequeño.
        if file_size < 10 * 1024 * 1024:  # 10 MB
            chunk_size = min_chunk_size  # Usar fragmentos más pequeños para archivos pequeños
        else:
            # Si el archivo es grande, usa fragmentos más grandes
            chunk_size = min(file_size // 10, max_chunk_size)  # Fragmentos más grandes pero no más grandes que max_chunk_size
        
        # Asegurarse de que el fragmento no sea menor que el tamaño mínimo ni mayor que el máximo
        chunk_size = max(min_chunk_size, min(chunk_size, max_chunk_size))
        
        return chunk_size

    @staticmethod
    def read_file_in_chunks(file_path, chunk_size=DEFAULT_CHUNK_SIZE):
        """Lee un archivo en fragmentos (chunks) para evitar cargarlo todo en memoria."""
        try:
            with open(file_path, 'rb') as file:
                while chunk := file.read(chunk_size):
                    yield chunk
        except Exception as e:
            logging.error(f"Error al leer el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al leer el archivo.")

    @staticmethod
    def create_qr_matrix(qr_images, output_path, qr_size=(300, 300)):
        """Genera una matriz de imágenes QR a partir de una lista de imágenes QR."""
        try:
            # Ordenar las imágenes QR por block_number (asegurando que están en el orden correcto)
            qr_images.sort(key=lambda x: x['block_number'])

            # Calcular las columnas y filas necesarias para la matriz
            columns = int(len(qr_images) ** 0.5)
            rows = (len(qr_images) + columns - 1) // columns

            qr_width, qr_height = qr_size

            # Crear una nueva imagen para la matriz
            matrix_image = Image.new('RGB', (qr_width * columns, qr_height * rows))

            for idx, img in enumerate(qr_images):
                # Verificar que la imagen tenga el tamaño adecuado
                qr_img = img['image']  # Suponiendo que 'image' contiene la imagen PIL
                
                # Asegurar que la imagen tenga el tamaño correcto (300x300)
                qr_img = qr_img.resize((qr_width, qr_height))

                # Calcular la posición de la imagen en la matriz
                row, col = divmod(idx, columns)
                matrix_image.paste(qr_img, (col * qr_width, row * qr_height))

            # Guardar la matriz de imágenes en el archivo especificado
            matrix_image.save(output_path)
            logging.info(f"Matriz QR guardada en '{output_path}'.")
        except Exception as e:
            logging.error(f"Error al crear la matriz QR: {e}")
            raise FileProcessingError("Error al crear la matriz QR.")

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
                decompressed_data = FileProcessor.decompress_data(block['data'])
                if decompressed_data is not None:
                    total_data += decompressed_data
                    logging.debug(f"Bloque {idx + 1} añadido, tamaño: {len(decompressed_data)} bytes.")
                else:
                    logging.warning(f"Bloque {idx + 1} no se pudo descomprimir. Siguiente bloque.")

            # Si no hay datos para escribir, no se guarda el archivo
            if total_data:
                with open(output_file, 'wb') as file:
                    file.write(total_data)
                logging.info(f"Archivo reconstruido guardado en: {output_file}")
            else:
                logging.warning("No se pudo reconstruir el archivo. No hay datos válidos.")

        except Exception as e:
            logging.error(f"Error al reconstruir el archivo: {e}")
            raise ValueError("Error al reconstruir el archivo.") from e

    @staticmethod
    def encrypt_file(file_path, secret_key, output_path=None, chunk_size=DEFAULT_CHUNK_SIZE):
        """Cifra un archivo usando AES con una clave secreta."""
        try:
            iv = os.urandom(16)  # Generar un vector de inicialización aleatorio
            cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
            encryptor = cipher.encryptor()

            if not output_path:
                output_path = f"{file_path}.enc"
            
            with open(file_path, 'rb') as input_file, open(output_path, 'wb') as output_file:
                output_file.write(iv)  # Escribir el IV al principio del archivo cifrado
                
                while chunk := input_file.read(chunk_size):
                    encrypted_chunk = encryptor.update(chunk)
                    output_file.write(encrypted_chunk)
                
            logging.info(f"Archivo cifrado guardado en '{output_path}'")
            return output_path
        except Exception as e:
            logging.error(f"Error al cifrar el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al cifrar el archivo.")

    @staticmethod
    def decrypt_file(file_path, secret_key, output_path=None, chunk_size=DEFAULT_CHUNK_SIZE):
        """Descifra un archivo previamente cifrado usando AES con una clave secreta."""
        try:
            with open(file_path, 'rb') as input_file:
                iv = input_file.read(16)  # Leer el IV del archivo cifrado
                cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                
                if not output_path:
                    output_path = file_path.replace('.enc', '.dec')
                
                with open(output_path, 'wb') as output_file:
                    while chunk := input_file.read(chunk_size):
                        decrypted_chunk = decryptor.update(chunk)
                        output_file.write(decrypted_chunk)
            
            logging.info(f"Archivo descifrado guardado en '{output_path}'")
            return output_path
        except Exception as e:
            logging.error(f"Error al descifrar el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al descifrar el archivo.")
