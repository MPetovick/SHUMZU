#!/usr/bin/env python3
"""
SHUMZU - QR Secure Storage & Transmission
Author: MikePetovick
Date: 2024-12-21
"""
import secrets
import base64
import json
import os
import logging
import argparse
import getpass
from pathlib import Path
from hashlib import sha3_256
from Crypto.Cipher import AES
import zstandard as zstd
import brotli
import qrcode
from pyzbar.pyzbar import decode
from PIL import Image
from tqdm import tqdm
from concurrent.futures import ThreadPoolExecutor
from argon2 import PasswordHasher

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

SALT_SIZE = 16
NONCE_SIZE = 12
COMPRESSION_LEVEL = 19
QR_SIZE = 200

ARGON2_TIME_COST = 2        
ARGON2_MEMORY_COST = 102400 
ARGON2_PARALLELISM = 8      
ARGON2_HASH_LENGTH = 32    

class SHUMZU:
    def __init__(self, password: str = None, block_size: int = 1024):
        self.password = password
        self.block_size = block_size
        self.argon2_hasher = PasswordHasher(
            time_cost=ARGON2_TIME_COST,
            memory_cost=ARGON2_MEMORY_COST,
            parallelism=ARGON2_PARALLELISM,
            hash_len=ARGON2_HASH_LENGTH,
            salt_len=SALT_SIZE
        )

    def derive_key(self, salt: bytes) -> bytes:
        if not self.password:
            raise ValueError("Password is required for key derivation.")
        password_str = self.password
        derived_key = self.argon2_hasher.hash(password_str, salt=salt)
        return derived_key[:ARGON2_HASH_LENGTH]

    def encrypt(self, data: bytes) -> str:
        salt, nonce = secrets.token_bytes(SALT_SIZE), secrets.token_bytes(NONCE_SIZE)
        key = self.derive_key(salt)
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        ciphertext, tag = cipher.encrypt_and_digest(data)
        return base64.b64encode(salt + nonce + tag + ciphertext).decode()

    def decrypt(self, encrypted_data: str) -> bytes:
        blob = base64.b64decode(encrypted_data)
        salt, nonce, tag, ciphertext = blob[:SALT_SIZE], blob[SALT_SIZE:SALT_SIZE+NONCE_SIZE], blob[SALT_SIZE+NONCE_SIZE:SALT_SIZE+NONCE_SIZE+16], blob[SALT_SIZE+NONCE_SIZE+16:]
        cipher = AES.new(self.derive_key(salt), AES.MODE_GCM, nonce=nonce)
        return cipher.decrypt_and_verify(ciphertext, tag)

    def compress(self, data: bytes) -> bytes:
        return zstd.ZstdCompressor(level=COMPRESSION_LEVEL).compress(brotli.compress(data))

    def decompress(self, data: bytes) -> bytes:
        return brotli.decompress(zstd.ZstdDecompressor().decompress(data))

    def generate_qr(self, data: bytes, index: int) -> Image.Image:
        encrypted = self.encrypt(self.compress(data)) if self.password else base64.b64encode(self.compress(data)).decode()
        qr = qrcode.QRCode(
            version=10, 
            error_correction=qrcode.constants.ERROR_CORRECT_L  
        )
        qr.add_data(json.dumps({'index': index, 'data': encrypted}))
        qr.make(fit=True)
        return qr.make_image(fill='black', back_color='white').resize((QR_SIZE, QR_SIZE))

    def decode_qr(self, image: Image.Image) -> dict:
        decoded_objects = decode(image)
        if not decoded_objects:
            raise ValueError("No QR codes detected.")
        
        if not self.password and any('data' in json.loads(obj.data) for obj in decoded_objects):
            self.password = getpass.getpass("Enter password for decryption (leave blank if unencrypted): ")
        
        result = {}
        for obj in decoded_objects:
            try:
                data = json.loads(obj.data)
                index = data['index']
                encrypted_data = data['data']
                
                if self.password:
                    decrypted_data = self.decompress(self.decrypt(encrypted_data))
                else:
                    decrypted_data = self.decompress(base64.b64decode(encrypted_data))
                
                result[index] = decrypted_data
            except (ValueError, KeyError) as e:
                logging.error(f"Error decoding QR block {index}: {e}")
                continue
        
        return result

    def process_file(self, file_path: str) -> tuple:
        data = Path(file_path).read_bytes()
        metadata = json.dumps({"file_name": os.path.basename(file_path), "hash": sha3_256(data).hexdigest()}).encode()
        return [metadata] + [data[i:i+self.block_size] for i in range(0, len(data), self.block_size)]

    def generate_qr_matrix(self, file_path: str, output_path: str):
        blocks = self.process_file(file_path)
        total_blocks = len(blocks)
        cols = int(total_blocks ** 0.5)
        rows = (total_blocks + cols - 1) // cols
        
        with ThreadPoolExecutor() as executor:
            qr_images = list(tqdm(executor.map(lambda x: self.generate_qr(x[1], x[0]), enumerate(blocks)), total=total_blocks, desc="Generating QR"))
        
        matrix_image = Image.new('RGB', (QR_SIZE * cols, QR_SIZE * rows))
        for idx, img in enumerate(qr_images):
            row, col = divmod(idx, cols)
            matrix_image.paste(img, (col * QR_SIZE, row * QR_SIZE))
        
        base_name = os.path.splitext(os.path.basename(file_path))[0]
        output_file = f"{base_name}_SHUMZU.png"
        
        counter = 1
        while os.path.exists(output_file):
            output_file = f"{base_name}_SHUMZU_{counter}.png"
            counter += 1
        
        matrix_image.save(output_file)
        logging.info(f"QR matrix saved to {output_file}")
        matrix_image.show()

    def decode_qr_matrix(self, image_path: str, output_folder: str):
        decoded_data = self.decode_qr(Image.open(image_path))
        metadata, file_data = json.loads(decoded_data[0].decode()), b''.join(decoded_data[idx] for idx in sorted(decoded_data) if idx)
        
        if metadata["hash"] != sha3_256(file_data).hexdigest():
            raise ValueError("File integrity check failed.")
        
        original_filename = metadata["file_name"]
        base_name, ext = os.path.splitext(original_filename)
        output_file = os.path.join(output_folder, original_filename)
        
        counter = 1
        while os.path.exists(output_file):
            output_file = os.path.join(output_folder, f"{base_name}_SHUMZU_{counter}{ext}")
            counter += 1
        
        Path(output_file).write_bytes(file_data)
        logging.info(f"File restored to {output_file}")
        

def main():
    parser = argparse.ArgumentParser(description="Generate or decode QR codes from files.")
    parser.add_argument('-f', '--file', help="Input file or QR matrix for decoding")
    parser.add_argument('-o', '--output', help="Output path for QR matrix or decoded file", default="output.png")
    parser.add_argument('-d', '--decode', help="Decode QR matrix", action='store_true')
    parser.add_argument('-p', '--password', help="Password for encryption/decryption (optional)")
    parser.add_argument('-of', '--output_folder', help="Output folder for decoded files", default=".")
    parser.add_argument('-bs', '--block_size', type=int, default=1024, help="Block size for splitting files (default: 1024)")
    args = parser.parse_args()

    password = args.password
    if not args.decode and not password:
        password = getpass.getpass("Enter password for encryption (leave blank for no encryption): ")
    
    shumzu = SHUMZU(password, args.block_size)
    try:
        if args.decode:
            if not args.file:
                raise ValueError("Provide QR matrix file with -f.")
            shumzu.decode_qr_matrix(args.file, args.output_folder)
        elif args.file:
            shumzu.generate_qr_matrix(args.file, args.output)
        else:
            logging.error("Provide a file or enable decoding.")
    except Exception as e:
        logging.error(f"Error: {e}")

if __name__ == '__main__':
    main()
