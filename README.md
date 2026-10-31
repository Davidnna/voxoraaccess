# Voxora Access

**Knowledge within everyone's reach.**  
_Listen. Learn. Explore. Achieve._

Voxora Access is a Flask-based learning-resource sharing prototype designed with visually impaired university students in mind. It provides account registration, public and private learning resources, account-to-account sharing, a personal library, embedded document previews, and browser-based read-aloud controls.

## Features

- Student registration, sign-in and sign-out
- Upload, search, browse, download and delete supported learning resources
- Public/private visibility and private sharing with registered accounts
- My Library references to existing resources rather than duplicate uploads
- SHA-256 duplicate detection
- Inline PDF previews for PDF files and server-converted DOCX/PPTX files, while retaining original downloads
- Keyboard skip link, focus indicators, semantic structure and responsive layout
- PostgreSQL database via Neon; uploaded file bytes are stored in PostgreSQL BYTEA

## Supported file types

PDF, DOCX, PPTX, TXT, MD, RTF and CSV are accepted by the upload validator. PDF, TXT, MD and CSV can be previewed directly; DOCX and PPTX are converted to PDF by LibreOffice when uploaded. The original Office file remains downloadable. ODT, ODS and ODP are accepted but do not currently have an embedded preview.

## Run locally

1. Install Python 3.12 or later.
2. Create and activate a virtual environment.
3. Install LibreOffice Writer and Impress (the packages listed in `apt.txt`) and dependencies with `pip install -r requirements.txt`.
4. Set environment variables:
    - `DATABASE_URL`: Neon PostgreSQL connection string; use the pooled URL if desired.
    - `VOXORA_SECRET_KEY`: long, random secret.
    - `VOXORA_MAX_UPLOAD_MB`: upload limit (default 20).
    - `VOXORA_HTTPS`: set to `1` when served over HTTPS.
5. Start with `flask --app app run`.

The application creates its database tables on startup.

## Deploy to Render

The repository includes `render.yaml`. Create a Render Web Service from this repository and set `DATABASE_URL` in the Render dashboard as a secret environment variable. Do not commit database credentials or a real `.env` file. Render can generate `VOXORA_SECRET_KEY` from the Blueprint configuration.

## Important prototype limitations

- Files are stored as PostgreSQL BYTEA data. This is convenient for a prototype but may be inefficient for larger libraries; consider object storage for production.
- The upload form text currently says 30 MB, while the application default is 20 MB.
- LibreOffice conversion may not perfectly preserve complex layouts, fonts, animations or embedded media. Conversion failures leave the original file available for download.
- A PDF preview is not automatically screen-reader accessible. Accessibility depends on the source document structure and whether the resulting PDF has selectable text and appropriate tags; scanned PDFs require OCR.
- The reader does not preserve full document layout, images, diagrams or complex table semantics.
- Browser speech synthesis and available voices vary by browser and operating system.
- There is no password reset, account deletion, user export, malware scanning or independent security/accessibility audit.
- The privacy notice is a draft and must be reviewed against actual hosting, retention practices and applicable law before public launch.

This is a student project prototype, not a certified accessibility or security product.
