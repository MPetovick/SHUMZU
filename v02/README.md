 ![SHUMZUlogo](/logo_SHUMZU.png) ![SHUMZUlogo](/logo_SHUMZU.png) ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)
SHUMZU modular  version 02
#

#### **Commands and Options**

1. **Generate Secret Key**:
   - **`--generate-key`**: Generate a new secret key. You need to provide a password with `--password` to encrypt the secret key.
   - Example:  
     ```bash
     python main.py --generate-key -p <your_password>
     ```

2. **Encrypt a File**:
   - **`--encrypt`**: Encrypt the file `keymaster.png` after generating it, using a password.
   - Example:
     ```bash
     python main.py -f <file_to_encrypt> -p <your_password> --encrypt
     ```

3. **Decrypt a File**:
   - **`--decrypt`**: Decrypt the file `keymaster.png` before using it (to recover the original data).
   - Example:
     ```bash
     python main.py -r <keymaster.png> -p <your_password> --decrypt
     ```

4. **Splitting a File into QR Codes**:
   - **`-f, --file`**: The file you want to split into QR code blocks.
   - **`-o, --output`**: The directory where the generated QR code files will be saved.
   - Example:
     ```bash
     python main.py -f <file_to_split> -p <your_password> -o <output_directory>
     ```

5. **Reconstruct a File from QR Codes**:
   - **`-r, --keymaster`**: The path to the encrypted `keymaster.png` (QR code matrix).
   - Example:
     ```bash
     python main.py -r <keymaster.png> -p <your_password> --decrypt
     ```
---

### Goals

- Increase the number of pages.
- Add compatibility with other text formats.
- Manipulate embedded images in files.

### Bug Fixes v01

- Compatibility with other formats (embedded images causing errors).
- Fixed errors in file reconstruction.
- More robust and modular code.

