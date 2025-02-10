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

### **3. Decoding and Reconstruct the File**
To decode the file:
- SHUMZU reads the QR code matrix image.
- It decodes each QR code into its corresponding block of encrypted data (if applicable).
- The blocks are recombined, decrypted (if applicable), and decompressed to reconstruct the original file.

#### **Command**
```bash
python SHUMZU.py -f <file_path> -o <output_qr_image> 
```
```bash
python SHUMZU.py -f <file_path> -o <output_qr_image> -bs 500
```
```bash
python SHUMZU.py -f <output_qr_image> -o <output_file> -d
```


- **`-f <file_path>`**: The file to convert.
- **`-o <output_name>`**: Path to save the SHUMZU file. (optional)
- **`-d`**: Enable decoding mode to decode QR codes.
- **`-bs`**: Configure the block size, default value 1024.

 ### **IMPORTANT: `BLOCK_SIZE` Configuration**  testing

| **File Type**            | **Extensions**                                        | **Recommended `BLOCK_SIZE`** |
|-------------------------|-----------------------------------------------------|-----------------------------|
| **Text & Code Files**    | `.txt`, `.md`, `.rtf`, `.html`, `.py`, `.java`, `.c` | `1024` bytes |
| **Heavy Documents**      | `.pdf`, `.doc`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx` | `420` bytes |
| **Images**              | `.png`, `.jpg`, `.jpeg`, `.gif`, `.bmp`, `.tiff`, `.webp` | `420` bytes |
| **Compressed Files**    | `.zip`, `.rar`, `.tar`, `.gz`, `.7z` | `420` bytes |
| **Audio & Video**       | `.mp3`, `.wav`, `.ogg`, `.mp4`, `.avi`, `.mkv`, `.mov` | `420` bytes |
| **Other Large Files**    | `.iso`, `.exe`, `.bin`, `.dmg` | `420` bytes |

🔹 **Reason for the adjustment**:  
- **`1024` for text/code files** → These files are more tolerant of data loss and reconstruction errors.  
- **`420` for more complex files (PDF, images, etc.)** → Reduces errors in decoding and data reconstruction.

---
