import base64
import json
import logging
import qrcode
from PIL import Image
from pyzbar.pyzbar import decode
from exceptions import QRCodeError
from blockchain import Blockchain

Image.MAX_IMAGE_PIXELS = None

class QRCodeHandler:

    @staticmethod
    def generate_qr_code(data, block_number, hash_value, secret_key, file_name=None, file_extension=None, qr_size=(300, 300)):
        try:
            qr_data = {
                'data': base64.b64encode(data).decode('utf-8'),
                'hash': hash_value,
                'block_number': block_number,
            }
            if file_name and block_number == 1:
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
            image = Image.open(keymaster_path)
            qr_codes = decode(image)

            if not qr_codes:
                raise QRCodeError("No se detectaron códigos QR en la matriz proporcionada.")

            decoded_data = []
            file_name = file_extension = None

            for idx, qr_code in enumerate(qr_codes):
                try:
                    qr_data_raw = qr_code.data.decode('utf-8')

                    if not isinstance(qr_data_raw, str):
                        raise ValueError(f"El contenido del QR en la posición {idx} no es una cadena válida: {qr_data_raw}")

                    qr_json = json.loads(qr_data_raw)

                    required_keys = ('data', 'hash', 'block_number')
                    if not all(key in qr_json for key in required_keys):
                        raise ValueError(f"El QR en la posición {idx} no tiene las claves requeridas: {qr_data_raw}")

                    if not isinstance(qr_json['data'], str):
                        raise ValueError(f"La clave 'data' en el QR {idx} no es del tipo esperado (cadena): {qr_json['data']}")
                    if not isinstance(qr_json['hash'], str):
                        raise ValueError(f"La clave 'hash' en el QR {idx} no es del tipo esperado (cadena): {qr_json['hash']}")
                    if not isinstance(qr_json['block_number'], int):
                        raise ValueError(f"La clave 'block_number' en el QR {idx} no es del tipo esperado (entero): {qr_json['block_number']}")

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
                    logging.error(f"Datos problemáticos del QR: {qr_code.data}")
                    raise ValueError(f"Error al procesar el QR en la posición {idx}: {block_error}")

            if not decoded_data:
                raise QRCodeError("No se pudieron decodificar datos válidos desde la matriz QR.")

            if not file_name or not file_extension:
                raise QRCodeError("Faltan metadatos del archivo (nombre o extensión) en los códigos QR.")

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
