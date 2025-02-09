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

#### **Command**
```bash
python SHUMZU.py -f <file_path> -o <output_qr_image> 
```
```bash
python SHUMZU.py -f <output_qr_image> -o <output_file> -d
```

- **`-f <qr_image_path>`**: The file to convert.
- **`-o <output_file>`**: Path to save the SHUMZU file. (optional)
- **`-d`**: Enable decoding mode to decode QR codes.
