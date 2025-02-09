## **SHUMZU - QR Secure Storage & Transmission**

### **How It Works**

### **1. File Splitting and Compression**
When generating the QR codes, SHUMZU does the following:
- It reads the input file and splits it into chunks (blocks).
- It compresses each chunk using Brotli and Zstandard algorithms to reduce the file size.
- It then encrypts the compressed data (optional, based on user input) with AES encryption and a user-provided password.
- Each encrypted block is then encoded into a QR code.

### **2. QR Code Matrix**
The QR codes are arranged in a matrix, with each QR code representing one block of the file. The QR code matrix can be saved as a single image and shared or transmitted easily.

### **3. Decoding and Recombining the File**
To decode the file:
- SHUMZU reads the QR code matrix image.
- It decodes each QR code into its corresponding block of encrypted data (if applicable).
- The blocks are recombined, decrypted (if applicable), and decompressed to reconstruct the original file.

## **Security Considerations**
1. **Password Protection**: When encrypting with a password, ensure that the password is stored securely. The security of the encryption depends on the strength of the password.
2. **File Integrity**: SHUMZU uses SHA3-256 hashing to ensure that the file is restored correctly and without corruption.

## **Limitations**
- The maximum size of the file that can be encoded is constrained by the size of the QR code and the limits of QR code storage capacity.
- Compression algorithms are used to reduce the size of the file before encoding, but very large files may require splitting into a large number of QR codes, resulting in a large image.

## **Command-Line Usage**

### **1. Generating QR Codes from Files**
You can use SHUMZU to convert files into QR codes for secure transmission.

#### **Command**
```bash
python SHUMZU.py -f <file_path> -o <output_qr_image> -p <password (optional)>
```

- **`-f <file_path>`**: The file to be split and encoded into QR codes.
- **`-o <output_qr_image>`**: Path to save the resulting image that contains all the QR codes.
- **`-p <password (optional)>`**: The password used for file encryption. If omitted, no encryption will occur.

#### **Example**
```bash
python SHUMZU.py -f large_file.txt -o qr_matrix.png -p mysecretpassword
```

### **2. Decoding QR Codes Back into a File**
To decode QR codes back into the original file, use the following command:

#### **Command**
```bash
python SHUMZU.py -f <qr_image_path> -o <output_file> -d -p <password (optional)>
```

- **`-f <qr_image_path>`**: The image containing the QR codes to decode.
- **`-o <output_file>`**: Path to save the restored file.
- **`-d`**: Enable decoding mode to decode QR codes.
- **`-p <password (optional)>`**: If the QR codes were encrypted with a password, you need to provide the same password to decrypt them.

#### **Example**
```bash
python SHUMZU.py -f qr_matrix.png -o restored_file.txt -d -p mysecretpassword
```

### **3. Decoding QR Codes Without Password**
If you didn't encrypt the file when generating QR codes, you can omit the password during decoding.

#### **Command**
```bash
python SHUMZU.py -f <qr_image_path> -o <output_file> -d
```

#### **Example**
```bash
python SHUMZU.py -f qr_matrix.png -o restored_file.txt -d
```
## **Example Workflow**

### **Step 1: Generate QR codes from a file**
```bash
python SHUMZU.py -f mylargefile.zip -o my_qr_matrix.png -p mypassword
```
This command will take `mylargefile.zip`, compress it, encrypt it using `mypassword`, split it into blocks, and generate QR codes. The QR codes will be saved in `my_qr_matrix.png`.

### **Step 2: Decode QR codes back into a file**
```bash
python SHUMZU.py -f my_qr_matrix.png -o restored_file.zip -d -p mypassword
```
This command will decode the QR codes from `my_qr_matrix.png`, decrypt the data using `mypassword`, and save the restored file as `restored_file.zip`.


