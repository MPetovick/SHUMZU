
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
- `-f` or `--file`: File to split into QR blocks.
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

### **Considerations:**

- **Password:** Use a strong password to ensure the encryption is secure.
- **Encryption:** You can choose to encrypt the QR code blocks during the splitting process for added security.
- **Decryption:** If the QR matrix is encrypted, you will need the password to decrypt it during reconstruction.

### **Conclusion:**
This tool offers a simple way to split and reconstruct files using QR codes, with optional encryption for added security. Ensure you store your password securely, as it is essential for encryption/decryption.

--- 

This version focuses on the essential commands, options, and workflow for users to split and reconstruct files securely with QR codes.
