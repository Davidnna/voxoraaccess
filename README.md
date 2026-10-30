# Voxora

**Knowledge within everyone's reach.**  
*Listen. Learn. Explore. Achieve.*

Voxora is a Flask-based learning-resource sharing prototype designed with visually impaired university students in mind. It provides account registration, public and private learning resources, account-to-account sharing, a personal library, document text extraction, and browser-based read-aloud controls.

## Features

- Student registration, sign-in and sign-out
- Upload, search, browse, download and delete supported learning resources
- Public/private visibility and private sharing with registered accounts
- My Library references to existing resources rather than duplicate uploads
- SHA-256 duplicate detection
- Accessible reading view with browser speech synthesis, pause/resume/stop and speed control
- Keyboard skip link, focus indicators, semantic structure and responsive layout
- PostgreSQL database via Neon; uploaded file bytes are stored in PostgreSQL BYTEA

## Supported file types

PDF, DOCX, PPTX, TXT, MD, RTF and CSV are accepted by the upload validator. ODT, ODS and ODP appear in the upload picker but text extraction for those formats is not implemented in this prototype.

## Run locally

1. Install Python 3.12 or later.
2. Create and activate a virtual environment.
3. Install dependencies with `pip install -r requirements.txt`.
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
- ODT/ODS/ODP are accepted but not extracted; scanned PDFs require OCR.
- The reader does not preserve full document layout, images, diagrams or complex table semantics.
- Browser speech synthesis and available voices vary by browser and operating system.
- There is no password reset, account deletion, user export, malware scanning or independent security/accessibility audit.
- The privacy notice is a draft and must be reviewed against actual hosting, retention practices and applicable law before public launch.

This is a student project prototype, not a certified accessibility or security product.
