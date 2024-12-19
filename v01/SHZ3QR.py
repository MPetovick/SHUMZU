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
import os
import base64
import qrcode
import json
import tempfile
import logging
import argparse
import shutil
from hashlib import sha3_256
from PIL import Image
from pyzbar.pyzbar import decode
from concurrent.futures import ThreadPoolExecutor, as_completed
from tqdm import tqdm
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives import padding

# Configuración de logging
logging.basicConfig(level=logging.INFO)

Image.MAX_IMAGE_PIXELS = None  # Deshabilitar la protección de bombas de descompresión

# Excepciones personalizadas
class QRCodeError(Exception):
    pass

class SecretKeyError(Exception):
    pass

class BlockchainError(Exception):
    pass

class FileProcessingError(Exception):
    pass

# Blockchain Handler
class Blockchain:
    """Clase para manejar operaciones relacionadas con la Blockchain."""
    def __init__(self):
        self.blocks = []

    def add_block(self, block, node_address):
        block_data = {'block': block, 'node_address': node_address}
        self.blocks.append(block_data)
        logging.info(f"Bloque añadido desde {node_address}: {block_data}")

    @staticmethod
    def hash_block(block):
        if isinstance(block, bytes):
            block = base64.b64encode(block).decode('utf-8')
        return sha3_256(block.encode('utf-8')).hexdigest()

# Key Management
class KeyManager:
    """Clase para manejar la clave secreta."""

    @staticmethod
    def read_secret_key():
        try:
            with open('secret.key', 'rb') as key_file:
                return key_file.read()
        except Exception as e:
            logging.error(f"Error al leer la clave secreta: {e}")
            raise SecretKeyError("Error al leer la clave secreta.")

    @staticmethod
    def encrypt_secret_key(secret_key, password):
        try:
            salt = os.urandom(16)
            key = sha3_256(password.encode()).digest()[:32]
            cipher = Cipher(algorithms.AES(key), modes.GCM(salt), backend=default_backend())
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(secret_key) + encryptor.finalize()
            return salt + encryptor.tag + ciphertext
        except Exception as e:
            logging.error(f"Error al encriptar la clave secreta: {e}")
            raise SecretKeyError("Error al encriptar la clave secreta.")

    @staticmethod
    def decrypt_secret_key(encrypted_key, password):
        try:
            salt, tag, ciphertext = encrypted_key[:16], encrypted_key[16:32], encrypted_key[32:]
            key = sha3_256(password.encode()).digest()[:32]
            cipher = Cipher(algorithms.AES(key), modes.GCM(salt, tag), backend=default_backend())
            decryptor = cipher.decryptor()
            return decryptor.update(ciphertext) + decryptor.finalize()
        except Exception as e:
            logging.error(f"Error al descifrar la clave secreta: {e}")
            raise SecretKeyError("Error al descifrar la clave secreta.")

    @staticmethod
    def save_encrypted_secret_key(secret_key, password):
        try:
            encrypted_key = KeyManager.encrypt_secret_key(secret_key, password)
            with open('secret.key', 'wb') as key_file:
                key_file.write(encrypted_key)
            logging.info("Clave secreta cifrada guardada en 'secret.key'.")
        except Exception as e:
            logging.error(f"Error al guardar la clave secreta cifrada: {e}")
            raise SecretKeyError("Error al guardar la clave secreta cifrada.")

    @staticmethod
    def load_encrypted_secret_key(password):
        try:
            with open('secret.key', 'rb') as key_file:
                encrypted_key = key_file.read()
            return KeyManager.decrypt_secret_key(encrypted_key, password)
        except Exception as e:
            logging.error(f"Error al cargar la clave secreta cifrada: {e}")
            raise SecretKeyError("Error al cargar la clave secreta cifrada.")

    @staticmethod
    def encrypt_file(input_path, output_path, password):
        try:
            key = sha3_256(password.encode()).digest()[:32]
            salt = os.urandom(16)
            cipher = Cipher(algorithms.AES(key), modes.GCM(salt), backend=default_backend())
            encryptor = cipher.encryptor()

            with open(input_path, 'rb') as infile, open(output_path, 'wb') as outfile:
                outfile.write(salt)
                while chunk := infile.read(1024):
                    outfile.write(encryptor.update(chunk))
                outfile.write(encryptor.finalize() + encryptor.tag)

            logging.info(f"Archivo '{input_path}' cifrado correctamente en '{output_path}'.")
        except Exception as e:
            logging.error(f"Error al cifrar el archivo '{input_path}': {e}")
            raise FileProcessingError("Error al cifrar el archivo.")

    @staticmethod
    def decrypt_file(input_path, output_path, password):
        try:
            with open(input_path, 'rb') as infile:
                salt = infile.read(16)
                tag = infile.read(16)
                key = sha3_256(password.encode()).digest()[:32]
                cipher = Cipher(algorithms.AES(key), modes.GCM(salt, tag), backend=default_backend())
                decryptor = cipher.decryptor()

                with open(output_path, 'wb') as outfile:
                    while chunk := infile.read(1024):
                        outfile.write(decryptor.update(chunk))
                    outfile.write(decryptor.finalize())

            logging.info(f"Archivo '{input_path}' descifrado correctamente en '{output_path}'.")
        except Exception as e:
            logging.error(f"Error al descifrar el archivo '{input_path}': {e}")
            raise FileProcessingError("Error al descifrar el archivo.")

# QR Code Handling
class QRCodeHandler:
    """Clase para generar, validar y decodificar códigos QR."""

    @staticmethod
    def generate_qr_code(data, block_number, hash_value, secret_key, file_name=None, file_extension=None, qr_size=(300, 300)):
        try:
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
            return img
        except Exception as e:
            logging.error(f"Error al generar el QR para el bloque {block_number}: {e}")
            raise QRCodeError(f"Error al generar el QR para el bloque {block_number}.")

    @staticmethod
    def validate_qr_images(qr_images):
        try:
            if not qr_images:
                raise ValueError("No hay imágenes QR válidas para procesar.")
            base_size = qr_images[0].size
            if any(img.size != base_size for img in qr_images):
                raise ValueError("Las dimensiones de las imágenes QR no son consistentes.")
            return qr_images
        except Exception as e:
            logging.error(f"Error al validar imágenes QR: {e}")
            raise QRCodeError("Error al validar imágenes QR.")
            

    @staticmethod
    def decode_qr_matrix(keymaster_path):
        try:
            # Abrir la imagen de la matriz QR
            image = Image.open(keymaster_path)
            qr_codes = decode(image)

            if not qr_codes:
                raise QRCodeError("No se detectaron códigos QR en la matriz proporcionada.")

            decoded_data = []
            file_name = file_extension = None

            for idx, qr_code in enumerate(qr_codes):
                try:
                    # Decodificar el contenido del QR como JSON
                    qr_data_raw = qr_code.data.decode('utf-8')

                    if not isinstance(qr_data_raw, str):
                        raise ValueError(f"El contenido del QR en la posición {idx} no es una cadena válida: {qr_data_raw}")

                    qr_json = json.loads(qr_data_raw)

                    # Validar estructura esperada
                    required_keys = ('data', 'hash', 'block_number')
                    if not all(key in qr_json for key in required_keys):
                        raise ValueError(f"El QR en la posición {idx} no tiene las claves requeridas: {qr_data_raw}")

                    # Validar tipo de datos en cada clave
                    if not isinstance(qr_json['data'], str):
                        raise ValueError(f"La clave 'data' en el QR {idx} no es del tipo esperado (cadena): {qr_json['data']}")
                    if not isinstance(qr_json['hash'], str):
                        raise ValueError(f"La clave 'hash' en el QR {idx} no es del tipo esperado (cadena): {qr_json['hash']}")
                    if not isinstance(qr_json['block_number'], int):
                        raise ValueError(f"La clave 'block_number' en el QR {idx} no es del tipo esperado (entero): {qr_json['block_number']}")

                    # Decodificar el bloque de datos
                    decoded_block_data = base64.b64decode(qr_json['data'])

                    # Validar hash del bloque
                    calculated_hash = Blockchain.hash_block(decoded_block_data)
                    if calculated_hash != qr_json['hash']:
                        raise ValueError(f"Hash inválido en el QR de la posición {idx}. Calculado: {calculated_hash}, Esperado: {qr_json['hash']}.")

                    # Obtener nombre y extensión del archivo si aún no han sido extraídos
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
                    logging.error(f"Datos problemáticos del QR: {qr_code.data}")
                    raise ValueError(f"Error al procesar el QR en la posición {idx}: {block_error}")

            # Validar que hay datos decodificados
            if not decoded_data:
                raise QRCodeError("No se pudieron decodificar datos válidos desde la matriz QR.")

            # Validar que el nombre y extensión del archivo se hayan definido
            if not file_name or not file_extension:
                raise QRCodeError("Faltan metadatos del archivo (nombre o extensión) en los códigos QR.")

            # Ordenar los bloques por número de bloque
            decoded_data.sort(key=lambda x: x['block_number'])

            logging.info(f"Decodificados {len(decoded_data)} bloques QR con éxito.")
            logging.info(f"Nombre del archivo: {file_name}, Extensión: {file_extension}")
            return decoded_data, file_name, file_extension

        except QRCodeError as qr_err:
            logging.error(f"Error en la decodificación de la matriz QR: {qr_err}")
            raise
        except Exception as e:
            logging.error(f"Error inesperado al decodificar la matriz QR desde '{keymaster_path}': {e}")
            raise QRCodeError("Error al decodificar la matriz QR.") from e
            
# File Processing
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
        """
        Divide los datos en bloques de tamaño ajustable dinámicamente basado en el tamaño del archivo.

        :param data: Los datos a dividir en bloques.
        :param file_path: Ruta al archivo para calcular el tamaño del bloque dinámicamente.
        :param file_name: Nombre del archivo (opcional).
        :param file_extension: Extensión del archivo (opcional).
        :param target_blocks: Número objetivo de bloques a generar.
        :param max_qr_size: Tamaño máximo del bloque QR.
        :return: Lista de bloques.
        """
        # Calcular el tamaño del bloque si se proporciona un archivo
        if file_path:
            block_size = FileProcessor.calculate_dynamic_block_size(file_path, target_blocks, max_qr_size)
        else:
            # Si no se proporciona file_path, usamos el block_size por defecto (1024)
            block_size = 1024

        # Crear los bloques dividiendo los datos
        blocks = [{'data': data[i:i + block_size]} for i in range(0, len(data), block_size)]

        # Verificar si se generaron bloques
        if not blocks:
            raise ValueError("No se generaron bloques. Verifique el tamaño de los datos o el tamaño del bloque.")

        # Asignar metadatos del archivo si se proporciona
        if len(blocks) > 1 and file_name:
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
    def reconstruct_file(decoded_data, file_name, file_extension):
        """
        Reconstruye un archivo a partir de los bloques de datos decodificados.
        
        :param decoded_data: Los bloques de datos decodificados que se usarán para reconstruir el archivo.
        :param file_name: Nombre del archivo original.
        :param file_extension: Extensión del archivo original.
        """
        try:
            # Validar que hay bloques
            if not decoded_data:
                raise ValueError("No hay datos para reconstruir el archivo.")

            base_name = os.path.splitext(file_name)[0]
            output_file = os.path.join(os.getcwd(), f"{base_name}_recuperado{file_extension}") if file_name else "archivo_reconstruido"

            # Inicializar variable para almacenar los datos del archivo
            total_data = b""

            # Verificar y agregar todos los bloques de datos (incluido el último bloque más pequeño)
            for idx, block in enumerate(decoded_data):
                total_data += block['data']
                logging.debug(f"Bloque {idx + 1} añadido, tamaño: {len(block['data'])} bytes.")

            # Verificar el tamaño total de los datos recuperados
            file_size = sum(len(block['data']) for block in decoded_data)
            expected_size = os.path.getsize(file_name)  # Tamaño esperado del archivo original

            logging.info(f"Tamaño del archivo reconstruido: {file_size} bytes, Tamaño esperado: {expected_size} bytes.")
            
            # Verificar si los tamaños coinciden
            if file_size != expected_size:
                logging.warning(f"El tamaño del archivo reconstruido ({file_size} bytes) no coincide con el tamaño original ({expected_size} bytes).")

            # Escribir los datos combinados en el archivo de salida
            with open(output_file, 'wb') as file:
                file.write(total_data)

            logging.info(f"Archivo reconstruido guardado en: {output_file}")
        
        except Exception as e:
            logging.error(f"Error al reconstruir el archivo: {e}")
            raise ValueError("Error al reconstruir el archivo.") from e


  
    @staticmethod
    def encrypt_file(file_path, secret_key, output_path=None):
        """
        Cifra un archivo utilizando la clave secreta.
        :param file_path: Ruta del archivo a cifrar.
        :param secret_key: Clave secreta para cifrado.
        :param output_path: Ruta de salida para guardar el archivo cifrado.
        """
        try:
            # Generar IV (Initialization Vector)
            iv = os.urandom(16)
            cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
            encryptor = cipher.encryptor()

            # Crear archivo de salida cifrado
            if not output_path:
                output_path = f"{file_path}.enc"
            
            with open(file_path, 'rb') as input_file, open(output_path, 'wb') as output_file:
                # Escribir IV al inicio del archivo cifrado
                output_file.write(iv)
                
                # Leer, cifrar y escribir datos en bloques
                while chunk := input_file.read(1024 * 1024):  # Bloques de 1 MB
                    encrypted_chunk = encryptor.update(chunk)
                    output_file.write(encrypted_chunk)
            
            logging.info(f"Archivo cifrado guardado en '{output_path}'")
            return output_path
        except Exception as e:
            logging.error(f"Error al cifrar el archivo '{file_path}': {e}")
            raise FileProcessingError("Error al cifrar el archivo.")

    @staticmethod
    def decrypt_file(file_path, secret_key, output_path=None):
        """
        Descifra un archivo utilizando la clave secreta.
        :param file_path: Ruta del archivo cifrado.
        :param secret_key: Clave secreta para descifrado.
        :param output_path: Ruta de salida para guardar el archivo descifrado.
        """
        try:
            with open(file_path, 'rb') as input_file:
                # Leer IV del inicio del archivo cifrado
                iv = input_file.read(16)
                cipher = Cipher(algorithms.AES(secret_key), modes.CFB(iv), backend=default_backend())
                decryptor = cipher.decryptor()
                
                # Crear archivo de salida descifrado
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


def main():
    parser = argparse.ArgumentParser(description="Divide un archivo en bloques QR o reconstruye un archivo desde una matriz QR protegida por contraseña.")
    parser.add_argument('-f', '--file', help="Archivo a dividir en bloques QR")
    parser.add_argument('-r', '--keymaster', help="Archivo de la matriz QR cifrada (keymaster.png)")
    parser.add_argument('--generate-key', action='store_true', help="Genera una nueva clave secreta")
    parser.add_argument('-p', '--password', help="Contraseña para cifrar/descifrar el archivo keymaster.png")
    parser.add_argument('-o', '--output', help="Directorio de salida para guardar los archivos generados")
    parser.add_argument('--decrypt', action='store_true', help="Indica que se debe descifrar el archivo keymaster.png antes de usarlo")
    parser.add_argument('--encrypt', action='store_true', help="Indica que se debe cifrar el archivo keymaster.png después de generarlo")

    args = parser.parse_args()

    try:
        # Generación de una nueva clave secreta
        if args.generate_key:
            if not args.password:
                logging.error("Debe proporcionar una contraseña con --password.")
                return
            KeyManager.save_encrypted_secret_key(os.urandom(32), args.password)
            return

        # Validación de la contraseña
        if not args.password:
            logging.error("Debe proporcionar una contraseña con --password.")
            return

        # Cargar la clave secreta
        try:
            secret_key = KeyManager.load_encrypted_secret_key(args.password)
            if secret_key is None:
                return
        except SecretKeyError:
            logging.error("No se pudo cargar la clave secreta.")
            return

        # Manejo del archivo a dividir en bloques QR
        if args.file:
            if not os.path.exists(args.file):
                logging.error(f"El archivo '{args.file}' no existe.")
                return

            try:
                qr_images = []
                output_name, extension = os.path.splitext(args.file)
                file_name = os.path.basename(args.file)

                # Usamos un directorio temporal si no se especifica un directorio de salida
                output_dir = args.output or os.getcwd()

                if not os.path.exists(output_dir):
                    os.makedirs(output_dir)

                # Calculamos el tamaño dinámico del bloque
                block_size = FileProcessor.calculate_dynamic_block_size(args.file)

                with tqdm(total=os.path.getsize(args.file), unit='B', unit_scale=True, desc="Leyendo archivo") as pbar:
                    blocks = []
                    with ThreadPoolExecutor() as executor:
                        futures = []

                        # Añadimos futuros para leer y procesar los bloques
                        for chunk in FileProcessor.read_file_in_chunks(args.file, block_size):
                            futures.append(executor.submit(FileProcessor.split_data_into_qr_blocks, chunk, file_name=file_name, file_extension=extension))

                        # Actualizamos la barra de progreso conforme procesamos los futuros
                        for future in as_completed(futures):
                            result = future.result()
                            blocks.extend(result)
                            pbar.update(len(result))

                    # Generación de códigos QR
                    with ThreadPoolExecutor() as qr_executor:
                        futures = [
                            qr_executor.submit(QRCodeHandler.generate_qr_code, block['data'], idx, Blockchain.hash_block(block['data']), secret_key, file_name=file_name, file_extension=extension)
                            for idx, block in enumerate(blocks)
                        ]

                        # Barra de progreso de la generación de QR
                        with tqdm(total=len(futures), desc="Generando códigos QR", ncols=100, dynamic_ncols=True, position=0, bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} Bloques procesados") as pbar_qr:
                            for future in as_completed(futures):
                                qr_images.append(future.result())
                                pbar_qr.update(1)

                    # Validación y creación de la matriz QR
                    qr_images = QRCodeHandler.validate_qr_images(qr_images)

                    # Guardamos la matriz QR en la ruta de salida especificada
                    keymaster_path = os.path.join(output_dir, "keymaster.png")
                    FileProcessor.create_qr_matrix(qr_images, keymaster_path)

                    # Cifrar el archivo si se indica la opción --encrypt
                    if args.encrypt:
                        keymaster_encrypted_path = os.path.join(output_dir, "keymaster_encrypted.png")
                        FileProcessor.encrypt_file(keymaster_path, secret_key, keymaster_encrypted_path)
                        os.remove(keymaster_path)  # Eliminamos el archivo sin cifrar
                        logging.info(f"Archivo 'keymaster.png' cifrado y guardado como 'keymaster_encrypted.png'.")

                logging.info(f"Bloques QR generados en '{output_dir}'")

            except Exception as e:
                logging.error(f"Error al procesar el archivo: {e}")

        # Manejo del archivo desde una matriz QR cifrada o sin cifrar (reconstrucción)
        elif args.keymaster:
            try:
                keymaster_path = args.keymaster

                # Si se especifica la opción --decrypt, desciframos el archivo
                if args.decrypt:
                    decrypted_keymaster_path = os.path.join(tempfile.gettempdir(), "keymaster_decrypted.png")
                    FileProcessor.decrypt_file(keymaster_path, secret_key, decrypted_keymaster_path)
                    keymaster_path = decrypted_keymaster_path  # Usamos el archivo descifrado para la reconstrucción

                decoded_data, file_name, file_extension = QRCodeHandler.decode_qr_matrix(keymaster_path)
                FileProcessor.reconstruct_file(decoded_data, file_name, file_extension)

                # Si se descifró, eliminamos el archivo temporal
                if args.decrypt:
                    os.remove(keymaster_path)

                logging.info("Proceso de reconstrucción de archivo desde matriz QR completado con éxito.")

            except QRCodeError as qr_err:
                logging.error(f"Error en la decodificación de la matriz QR: {qr_err}")
            except FileProcessingError as file_err:
                logging.error(f"Error al procesar el archivo durante la reconstrucción: {file_err}")
            except Exception as e:
                logging.error(f"Error inesperado durante la reconstrucción del archivo: {e}")

    except Exception as e:
        logging.error(f"Error crítico en la aplicación: {e}")


if __name__ == '__main__':
    main()                                

