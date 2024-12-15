# QR Hash Generator - User Manual

## What Does It Do?

This script reads QR codes from an image, generates their SHA3-256 hashes, and creates a PDF report with:

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
python qr_hash_generator.py -i <image_path>
```

### Arguments:
- `-i <image_path>`: **Required**. Path to the image containing QR codes.

### Example:

```bash
python qr_hash_generator.py -i qr_image.png
```

This will:
1. Extract QR codes from `qr_image.png`.
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