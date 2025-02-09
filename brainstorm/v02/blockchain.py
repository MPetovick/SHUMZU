import base64
import logging
from hashlib import sha3_256

class Blockchain:
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
