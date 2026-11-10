# Voxora Access

**Knowledge within everyone's reach.**  
_Listen. Learn. Explore. Achieve._

Voxora Access is a React single-page application with a Flask API and PostgreSQL backend, designed with visually impaired university students in mind. React Router owns in-app navigation while Flask handles authentication, resource permissions, uploads, document previews and AI requests. The voice assistant stays mounted across route changes.

## Features

- Student registration, sign-in and sign-out
- Upload, search, browse, download and delete supported learning resources
- Public/private visibility and private sharing with registered accounts
- My Library references to existing resources rather than duplicate uploads
- SHA-256 duplicate detection
- Inline PDF previews for PDF files and server-converted DOCX/PPTX files, while retaining original downloads
- React Router client-side navigation for public, authentication and workspace pages
- Persistent voice controls and voice-operated navigation, page reading, visible-control activation and safe form assistance
- Page-aware AI responses using the visible page content as context
- Keyboard skip link, route-change focus management, focus indicators, semantic structure and responsive layout
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
5. Build the React frontend with `npm install && npm run build`.
6. Start the Flask API and SPA shell with `flask --app app run`.

The application creates its database tables on startup.

## Deploy to Render

The repository includes `render.yaml`. Create a Render Web Service from this repository and set `DATABASE_URL` in the Render dashboard as a secret environment variable. Do not commit database credentials or a real `.env` file. Render can generate `VOXORA_SECRET_KEY` from the Blueprint configuration.

## Voice assistant interaction

The assistant can navigate internal pages without a full document reload, read the current page aloud on request, scroll, activate visible buttons or links by their labels, and enter ordinary non-password text into labelled fields. It can guide users to the upload page, but browser security still requires the user to choose local files. Passwords must be entered privately in the sign-in form. Voice recognition and interruption accuracy depend on browser support, microphone permission and acoustic echo cancellation.

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
