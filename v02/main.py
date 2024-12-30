import os
import logging
import argparse
import tempfile
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor, as_completed
from blockchain import Blockchain
from key_manager import KeyManager
from qr_code_handler import QRCodeHandler
from file_processor import FileProcessor
from exceptions import QRCodeError, SecretKeyError, BlockchainError, FileProcessingError

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

    # Configurar el logging
    logging.basicConfig(level=logging.INFO)

    try:
        if args.generate_key:
            if not args.password:
                logging.error("Debe proporcionar una contraseña con --password.")
                return
            KeyManager.save_encrypted_secret_key(os.urandom(32), args.password)
            logging.info("Clave secreta generada y guardada de forma segura.")
            return

        if not args.password:
            logging.error("Debe proporcionar una contraseña con --password.")
            return

        try:
            secret_key = KeyManager.load_encrypted_secret_key(args.password)
            if secret_key is None:
                return
        except SecretKeyError:
            logging.error("No se pudo cargar la clave secreta.")
            return

        if args.file:
            if not os.path.exists(args.file):
                logging.error(f"El archivo '{args.file}' no existe.")
                return

            try:
                qr_images = []
                output_name, extension = os.path.splitext(args.file)
                file_name = os.path.basename(args.file)

                output_dir = args.output or os.getcwd()

                if not os.path.exists(output_dir):
                    os.makedirs(output_dir)

                # Obtener el tamaño del archivo antes de calcular el tamaño del bloque
                file_size = os.path.getsize(args.file)
                block_size = FileProcessor.calculate_dynamic_block_size(file_size)

                with tqdm(total=file_size, unit='B', unit_scale=True, desc="Leyendo archivo") as pbar:
                    blocks = []
                    with ThreadPoolExecutor() as executor:
                        futures = []

                        # Leer archivo en fragmentos y generar bloques
                        for chunk in FileProcessor.read_file_in_chunks(args.file, block_size):
                            futures.append(executor.submit(FileProcessor.split_data_into_qr_blocks, chunk, file_name=file_name, file_extension=extension))

                        for future in as_completed(futures):
                            result = future.result()
                            blocks.extend(result)
                            pbar.update(len(result))

                    # Generación de códigos QR para cada bloque
                    with ThreadPoolExecutor() as qr_executor:
                        futures = [
                            qr_executor.submit(QRCodeHandler.generate_qr_code, block['data'], idx, Blockchain.hash_block(block['data']), secret_key, file_name=file_name, file_extension=extension)
                            for idx, block in enumerate(blocks)
                        ]

                        with tqdm(total=len(futures), desc="Generando códigos QR", ncols=100, dynamic_ncols=True, position=0, bar_format="{l_bar}{bar}| {n_fmt}/{total_fmt} Bloques procesados") as pbar_qr:
                            for future in as_completed(futures):
                                qr_images.append(future.result())
                                pbar_qr.update(1)

                    # Validar imágenes QR generadas
                    qr_images = QRCodeHandler.validate_qr_images(qr_images)

                    keymaster_path = os.path.join(output_dir, "keymaster.png")
                    FileProcessor.create_qr_matrix(qr_images, keymaster_path)

                    # Si se indica la opción de cifrado, cifrar el archivo keymaster.png
                    if args.encrypt:
                        keymaster_encrypted_path = os.path.join(output_dir, "keymaster_encrypted.png")
                        FileProcessor.encrypt_file(keymaster_path, secret_key, keymaster_encrypted_path)
                        os.remove(keymaster_path)  # Eliminamos el archivo sin cifrar
                        logging.info(f"Archivo 'keymaster.png' cifrado y guardado como 'keymaster_encrypted.png'.")

                logging.info(f"Bloques QR generados en '{output_dir}'")

            except FileProcessingError as e:
                logging.error(f"Error al procesar el archivo: {e}")
            except Exception as e:
                logging.error(f"Error inesperado al procesar el archivo: {e}")

        elif args.keymaster:
            try:
                keymaster_path = args.keymaster

                # Si se debe descifrar el archivo keymaster.png antes de procesarlo
                if args.decrypt:
                    decrypted_keymaster_path = os.path.join(tempfile.gettempdir(), "keymaster_decrypted.png")
                    FileProcessor.decrypt_file(keymaster_path, secret_key, decrypted_keymaster_path)
                    keymaster_path = decrypted_keymaster_path  

                # Decodificar la matriz QR y reconstruir el archivo
                decoded_data, file_name, file_extension = QRCodeHandler.decode_qr_matrix(keymaster_path)
                FileProcessor.reconstruct_file(decoded_data, file_name, file_extension)

                # Si se ha descifrado, eliminar el archivo descifrado temporal
                if args.decrypt:
                    os.remove(keymaster_path)

                logging.info("Proceso de reconstrucción de archivo desde matriz QR completado con éxito.")

            except QRCodeError as qr_err:
                logging.error(f"Error en la decodificación de la matriz QR: {qr_err}")
            except FileProcessingError as file_err:
                logging.error(f"Error al procesar el archivo durante la reconstrucción: {file_err}")
            except Exception as e:
                logging.error(f"Error inesperado durante la reconstrucción: {e}")

    except Exception as e:
        logging.error(f"Error inesperado en el programa: {e}")

if __name__ == "__main__":
    main()
