import os
import logging
import base64
import json
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes
from hashlib import sha3_256
from exceptions import SecretKeyError, FileProcessingError

class KeyManager:
 
    @staticmethod
    def generate_salt() -> bytes:

        return os.urandom(16)

    @staticmethod
    def derive_key(password: str, salt: bytes) -> bytes:

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,  # Clave de 256 bits
            salt=salt,
            iterations=100000,  # Alta cantidad de iteraciones para hacer más lento el proceso
            backend=default_backend()
        )
        return kdf.derive(password.encode())

    @staticmethod
    def generate_secret_key(password):

        salt = KeyManager.generate_salt()
        return KeyManager.derive_key(password, salt)

    @staticmethod
    def encrypt_secret_key(secret_key, password):

        try:
            salt = KeyManager.generate_salt()  # Salt aleatorio
            key = KeyManager.derive_key(password, salt)  # Derivar clave de cifrado
            cipher = Cipher(algorithms.AES(key), modes.GCM(salt), backend=default_backend())
            encryptor = cipher.encryptor()
            ciphertext = encryptor.update(secret_key) + encryptor.finalize()
            return salt + encryptor.tag + ciphertext  # Guardar salt + tag + ciphertext
        except Exception as e:
            logging.error(f"Error al encriptar la clave secreta: {e}")
            raise SecretKeyError("Error al encriptar la clave secreta.")

    @staticmethod
    def decrypt_secret_key(encrypted_key, password):

        try:
            salt, tag, ciphertext = encrypted_key[:16], encrypted_key[16:32], encrypted_key[32:]
            key = KeyManager.derive_key(password, salt)  # Derivar clave de cifrado
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
            salt = KeyManager.generate_salt()
            key = KeyManager.derive_key(password, salt)

            cipher = Cipher(algorithms.AES(key), modes.GCM(salt), backend=default_backend())
            encryptor = cipher.encryptor()

            with open(input_path, 'rb') as infile, open(output_path, 'wb') as outfile:
                outfile.write(salt)
                while chunk := infile.read(2048):
                    outfile.write(encryptor.update(chunk))
                outfile.write(encryptor.finalize() + encryptor.tag)

            logging.info(f"Archivo '{input_path}' cifrado correctamente en '{output_path}'.")

            # Almacenar metadatos en formato JSON
            metadata = {
                "salt": base64.b64encode(salt).decode('utf-8'),
                "iterations": 100000,
                "algorithm": "AES",
                "mode": "GCM"
            }
            with open(output_path + ".meta", 'w') as meta_file:
                json.dump(metadata, meta_file)

        except Exception as e:
            logging.error(f"Error al cifrar el archivo '{input_path}': {e}")
            raise FileProcessingError("Error al cifrar el archivo.")

    @staticmethod
    def decrypt_file(input_path, output_path, password):

        try:
            with open(input_path, 'rb') as infile:
                salt = infile.read(16)
                tag = infile.read(16)
                key = KeyManager.derive_key(password, salt)

                cipher = Cipher(algorithms.AES(key), modes.GCM(salt, tag), backend=default_backend())
                decryptor = cipher.decryptor()

                with open(output_path, 'wb') as outfile:
                    while chunk := infile.read(4096):
                        outfile.write(decryptor.update(chunk))
                    outfile.write(decryptor.finalize())

            logging.info(f"Archivo '{input_path}' descifrado correctamente en '{output_path}'.")

        except Exception as e:
            logging.error(f"Error al descifrar el archivo '{input_path}': {e}")
            raise FileProcessingError("Error al descifrar el archivo.")
