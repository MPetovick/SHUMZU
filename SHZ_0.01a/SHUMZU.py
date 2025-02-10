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
from argon2.low_level import hash_secret_raw, Type
from typing import List, Dict, Optional, Tuple

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

SALT_SIZE = 16
NONCE_SIZE = 12
COMPRESSION_LEVEL = 19
QR_SIZE = 200

ARGON2_PARAMS = {
    "time_cost": 2,
    "memory_cost": 102400,
    "parallelism": 8,
    "hash_len": 32,
    "type": Type.ID,
}

class SHUMZU:
    def __init__(self, password: Optional[str] = None, block_size: int = 1024):
        self.password = password
        self.block_size = block_size

    def derive_key(self, salt: bytes) -> bytes:
        """Derives a key using Argon2."""
        if not self.password:
            raise ValueError("Password is required for key derivation.")
        
        key = hash_secret_raw(
            secret=self.password.encode(),
            salt=salt,
            **ARGON2_PARAMS
        )
        return key

    def encrypt(self, data: bytes) -> str:
        """Encrypts data using AES-GCM."""
        salt = secrets.token_bytes(SALT_SIZE)
        nonce = secrets.token_bytes(NONCE_SIZE)
        key = self.derive_key(salt)
        cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
        ciphertext, tag = cipher.encrypt_and_digest(data)
        
        encrypted_blob = salt + nonce + tag + ciphertext
        return base64.b64encode(encrypted_blob).decode()

    def decrypt(self, encrypted_data: str) -> bytes:
        """Decrypts data using AES-GCM."""
        try:
            blob = base64.b64decode(encrypted_data)
            salt, nonce, tag, ciphertext = (
                blob[:SALT_SIZE],
                blob[SALT_SIZE:SALT_SIZE+NONCE_SIZE],
                blob[SALT_SIZE+NONCE_SIZE:SALT_SIZE+NONCE_SIZE+16],
                blob[SALT_SIZE+NONCE_SIZE+16:],
            )
            key = self.derive_key(salt)
            return AES.new(key, AES.MODE_GCM, nonce=nonce).decrypt_and_verify(ciphertext, tag)
        except Exception as e:
            raise ValueError(f"Decryption failed: {e}")

    def compress(self, data: bytes) -> bytes:
        """Compresses data using Brotli and Zstandard."""
        return zstd.ZstdCompressor(level=COMPRESSION_LEVEL).compress(brotli.compress(data))

    def decompress(self, data: bytes) -> bytes:
        """Decompresses data using Brotli and Zstandard."""
        return brotli.decompress(zstd.ZstdDecompressor().decompress(data))

    def generate_qr(self, data: bytes, index: int) -> Image.Image:
        """Generates a QR code from data."""
        encrypted = self.encrypt(self.compress(data)) if self.password else base64.b64encode(self.compress(data)).decode()
        qr = qrcode.QRCode(version=10, error_correction=qrcode.constants.ERROR_CORRECT_L)
        qr.add_data(json.dumps({'index': index, 'data': encrypted}))
        qr.make(fit=True)
        return qr.make_image(fill='black', back_color='white').resize((QR_SIZE, QR_SIZE))

    def decode_qr(self, image: Image.Image) -> Dict[int, bytes]:
        """Decodes a QR code and returns the data."""
        decoded_objects = decode(image)
        if not decoded_objects:
            raise ValueError("No QR codes detected.")
        
        result = {}
        for obj in decoded_objects:
            try:
                data = json.loads(obj.data)
                if not isinstance(data, dict) or 'index' not in data or 'data' not in data:
                    logging.error(f"Invalid QR block structure: {obj.data}")
                    continue
                
                index = data['index']
                encrypted_data = data['data']
                decrypted_data = (
                    self.decompress(self.decrypt(encrypted_data)) if self.password 
                    else self.decompress(base64.b64decode(encrypted_data))
                )
                result[index] = decrypted_data
            except json.JSONDecodeError:
                logging.error(f"Invalid JSON in QR block: {obj.data}")
            except Exception as e:
                logging.error(f"Error decoding QR block: {e}")
        return result

    def process_file(self, file_path: str) -> Tuple[bytes, List[bytes]]:
        """Processes a file into blocks and generates metadata."""
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"The file {file_path} does not exist.")
        
        data = Path(file_path).read_bytes()
        if not data:
            raise ValueError("The file is empty.")
        
        metadata = json.dumps({"file_name": os.path.basename(file_path), "hash": sha3_256(data).hexdigest()}).encode()
        return metadata, [data[i:i+self.block_size] for i in range(0, len(data), self.block_size)]

    def generate_qr_matrix(self, file_path: str, output_path: str):
        """Generates a QR code matrix in parallel."""
        metadata, blocks = self.process_file(file_path)
        total_blocks = len(blocks) + 1
        cols = int(total_blocks ** 0.5)
        rows = (total_blocks + cols - 1) // cols
        
        with ThreadPoolExecutor() as executor:
            qr_images = list(tqdm(executor.map(lambda x: self.generate_qr(x[1], x[0]), enumerate([metadata] + blocks)), total=total_blocks, desc="Generating QR"))
        
        matrix_image = Image.new('RGB', (QR_SIZE * cols, QR_SIZE * rows))
        for idx, img in enumerate(qr_images):
            row, col = divmod(idx, cols)
            matrix_image.paste(img, (col * QR_SIZE, row * QR_SIZE))
        
        output_file = self._get_unique_filename(output_path)
        matrix_image.save(output_file)
        logging.info(f"QR matrix saved to {output_file}")
        matrix_image.show()

    def decode_qr_matrix(self, image_path: str, output_folder: str):
        """Decodes a QR code matrix and reconstructs the original file."""
        if not os.path.exists(image_path):
            raise FileNotFoundError(f"The image {image_path} does not exist.")
        
        decoded_data = self.decode_qr(Image.open(image_path))
        metadata, file_data = json.loads(decoded_data[0].decode()), b''.join(decoded_data[idx] for idx in sorted(decoded_data) if idx)
        
        if metadata["hash"] != sha3_256(file_data).hexdigest():
            raise ValueError("File integrity check failed.")
        
        output_file = self._get_unique_filename(os.path.join(output_folder, metadata["file_name"]))
        Path(output_file).write_bytes(file_data)
        logging.info(f"File restored to {output_file}")

    def _get_unique_filename(self, path: str) -> str:
        """Generates a unique filename to avoid overwriting."""
        base, ext = os.path.splitext(path)
        counter = 1
        while os.path.exists(path):
            path = f"{base}_{counter}{ext}"
            counter += 1
        return path

def main():
    parser = argparse.ArgumentParser(description="Generate or decode QR codes from files.")
    parser.add_argument('-f', '--file', help="Input file or QR matrix for decoding", required=True)
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
            shumzu.decode_qr_matrix(args.file, args.output_folder)
        else:
            shumzu.generate_qr_matrix(args.file, args.output)
    except Exception as e:
        logging.error(f"Error: {e}")

if __name__ == '__main__':
    main()
