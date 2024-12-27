import zstandard as zstd
import os
import multiprocessing
import logging
import time
from tqdm import tqdm
import hashlib
import argparse

# Configuración de logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def calculate_threads(file_size):
    """
    Calcula el número óptimo de hilos según el tamaño del archivo y los núcleos de la CPU.
    """
    max_threads = multiprocessing.cpu_count() - 1  # Deja un núcleo libre
    if file_size < 100 * 1024 * 1024:  # Menos de 100 MB
        return min(2, max_threads)
    elif file_size < 1 * 1024 * 1024 * 1024:  # Menos de 1 GB
        return min(4, max_threads)
    else:  # Más de 1 GB
        return min(8, max_threads)


def calculate_block_size(file_size):
    """
    Determina dinámicamente el tamaño del bloque en función del tamaño del archivo.
    """
    if file_size < 100 * 1024 * 1024:  # Menos de 100 MB
        return 512 * 1024  # 512 KB
    elif file_size < 1 * 1024 * 1024 * 1024:  # Menos de 1 GB
        return 1 * 1024 * 1024  # 1 MB
    else:  # Más de 1 GB
        return 4 * 1024 * 1024  # 4 MB


def validate_compression_level(level):
    """
    Valida que el nivel de compresión esté en el rango permitido por Zstandard.
    """
    if not (1 <= level <= 22):
        raise ValueError(f"El nivel de compresión debe estar entre 1 y 22. Recibido: {level}")


def calculate_file_hash(file_path):
    """
    Calcula un hash MD5 del archivo para verificación de integridad.
    """
    hash_md5 = hashlib.md5()
    with open(file_path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def process_file(input_path, output_path, operation, **kwargs):
    """
    Procesa un archivo para compresión o descompresión con progreso y múltiples hilos.
    """
    try:
        if not os.path.exists(input_path):
            raise FileNotFoundError(f"Archivo no encontrado: {input_path}")

        file_size = os.path.getsize(input_path)
        threads = calculate_threads(file_size)
        block_size = kwargs.get("block_size", calculate_block_size(file_size))
        logging.info(f"{operation.capitalize()} archivo de {file_size / (1024 ** 2):.2f} MB usando {threads} hilos.")

        start_time = time.time()
        with open(input_path, "rb") as input_file, open(output_path, "wb") as output_file:
            with tqdm(total=file_size, unit="B", unit_scale=True, desc=operation.capitalize()) as progress:
                if operation == "compresión":
                    level = kwargs.get("level", 3)
                    validate_compression_level(level)
                    compressor = zstd.ZstdCompressor(level=level, threads=threads)
                    with compressor.stream_writer(output_file) as writer:
                        while chunk := input_file.read(block_size):
                            writer.write(chunk)
                            progress.update(len(chunk))
                elif operation == "descompresión":
                    decompressor = zstd.ZstdDecompressor(threads=threads)
                    with decompressor.stream_reader(input_file) as reader:
                        while chunk := reader.read(block_size):
                            output_file.write(chunk)
                            progress.update(len(chunk))
                else:
                    raise ValueError("Operación no válida. Use 'compresión' o 'descompresión'.")

        logging.info(f"{operation.capitalize()} completada en {time.time() - start_time:.2f} segundos.")
    except Exception as e:
        logging.error(f"Error durante la {operation}: {e}")


def compress_file(input_path, output_path, level=22):
    """
    Comprime un archivo con Zstandard.
    """
    process_file(input_path, output_path, "compresión", level=level)


def decompress_file(input_path, output_path):
    """
    Descomprime un archivo con Zstandard.
    """
    process_file(input_path, output_path, "descompresión")


def compress_multiple_files(file_paths, output_dir, level=22):
    """
    Comprime múltiples archivos y los guarda en el directorio de salida.
    """
    for file_path in file_paths:
        output_path = os.path.join(output_dir, os.path.basename(file_path) + ".zst")
        compress_file(file_path, output_path, level)


def main():
    """
    Interfaz de línea de comandos para la utilidad.
    """
    parser = argparse.ArgumentParser(description="Utilidad de compresión y descompresión con Zstandard")
    parser.add_argument("operation", choices=["compress", "decompress"], help="Operación a realizar")
    parser.add_argument("input", help="Archivo o directorio de entrada")
    parser.add_argument("output", help="Archivo o directorio de salida")
    parser.add_argument("--level", type=int, default=22, help="Nivel de compresión (1-22)")
    args = parser.parse_args()

    if os.path.isdir(args.input):  # Si es un directorio
        if args.operation == "compress":
            compress_multiple_files([os.path.join(args.input, f) for f in os.listdir(args.input)], args.output, args.level)
        else:
            logging.error("La descompresión de múltiples archivos no está soportada aún.")
    else:  # Si es un archivo
        if args.operation == "compress":
            compress_file(args.input, args.output, level=args.level)
        elif args.operation == "decompress":
            decompress_file(args.input, args.output)


if __name__ == "__main__":
    main()