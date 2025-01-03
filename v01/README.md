 ![SHUMZUlogo](/logo_SHUMZU.png) ![SHUMZUlogo](/logo_SHUMZU.png) ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)  ![SHUMZUlogo](/logo_SHUMZU.png)
SHZ3QR & SHZverified version 01
#
# **SHZ3QR - User Manual**

## Requirements

Install dependencies with:

```bash
pip install -r requirements.txt
```

---

### **Commands:**

#### **1. Generate a Secret Key**
Before splitting or reconstructing files, generate a secret key. This key is used for encryption/decryption.

**Command:**
```bash
python SHZ3QR.py --generate-key -p <password>
```
- `--generate-key`: Creates a new secret key.
- `-p` or `--password`: Password used to encrypt the secret key.

**Example:**
```bash
python SHZ3QR.py --generate-key -p mySecurePassword123
```

---

#### **2. Split a File into QR Code Blocks (Encrypted or Not)**
Once you have the secret key, split a file into QR code blocks. You can choose to encrypt the blocks.

**Command:**
```bash
python SHZ3QR.py -f <file_to_split> -p <password> --output <output_directory> [--encrypt]
```
- `-f` or `--file`: File to split into QR blocks. (.txt .md .rtf)
- `-p` or `--password`: Password for encrypting the QR blocks.
- `--encrypt`: (Optional) Encrypt the QR blocks.
- `--output`: (Optional) Directory to save QR blocks.

**Example (no encryption):**
```bash
python SHZ3QR.py -f myfile.pdf -p mySecurePassword123 --output ./output
```

**Example (with encryption):**
```bash
python SHZ3QR.py -f myfile.pdf -p mySecurePassword123 --output ./output --encrypt
```

---

#### **3. Reconstruct a File from a QR Code Matrix**
Reconstruct a file from an encrypted or unencrypted QR code matrix.

**Command:**
```bash
python SHZ3QR.py -r <keymaster.png> -p <password> [--decrypt]
```
- `-r` or `--keymaster`: Path to the QR code matrix.
- `-p` or `--password`: Password for decrypting the matrix.
- `--decrypt`: (Optional) Decrypt the QR code matrix.

**Example (with decryption):**
```bash
python SHZ3QR.py -r keymaster.png -p mySecurePassword123 --decrypt
```

---

### **Workflow:**

1. **Generate a Secret Key:**
   - Run the command to create a secret key with a secure password.
   ```bash
   python SHZ3QR.py --generate-key -p mySecurePassword123
   ```

2. **Split the File:**
   - Split the file into QR code blocks. Choose whether to encrypt the blocks.
   ```bash
   python SHZ3QR.py -f mydocument.txt -p mySecurePassword123 --output ./qr_blocks --encrypt
   ```

3. **Reconstruct the File:**
   - Reconstruct the file from the QR code matrix, and decrypt it if needed.
   ```bash
   python SHZ3QR.py -r ./qr_blocks/keymaster.png -p mySecurePassword123 --decrypt
   ```

---

# SHZverified - User Manual

## What Does It Do?

This script reads QR codes from a keymaster, generates their SHA3-256 hashes, and creates a PDF report with:

1. A table of QR content and their corresponding hashes.
2. The QR code image for reference.

## Requirements

Install dependencies with:

```bash
pip install -r requirements.txt
```

---

## How to Use

### Step 1: Run the Script

```bash
python SHZverified.py -i <image_path>
```

### Arguments:
- `-i <image_path>`: **Required**. Path to the image containing QR codes.

### Example:

```bash
python SHZverified.py -i keymaster.png
```

This will:
1. Extract QR codes from `keymaster.png`.
2. Generate SHA3-256 hashes.
3. Create a PDF with the QR content, hash, and image.

---

## Output

- **PDF Name**: `qr_hashes_<timestamp>.pdf`.
- **Contents**:
  - A table with QR content and SHA3-256 hash (first 40 characters).
  - The QR image.
  - Footer with the creation date and time.

---

## Error Handling

- **No QR codes found**: Make sure the image contains valid QR codes.
- **Image not found**: Check the image path.
- **Error opening image**: Ensure the image is in a supported format (PNG, JPEG).

---

