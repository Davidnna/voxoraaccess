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
- React Router client-side navigation for internal links, with Flask retained for APIs and server-side resource delivery
- Persistent voice assistant with page-aware explanations, on-demand page/document reading, voice navigation, visible-control activation, safe form-field filling and scrolling
- Groq tool calling for resource discovery and account-scoped library/resource actions
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
    - `GROQ_API_KEY`: API key for the Groq-hosted assistant model and tool calling.
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
- Browser speech recognition and speech synthesis vary by browser and operating system. The voice layer requests microphone echo cancellation, noise suppression and automatic gain control, then uses local voice-activity detection to gate interruptions. If the browser does not expose echo cancellation, Voxora falls back to half-duplex speech (it pauses recognition while speaking) so it cannot transcribe its own TTS; use the always-visible Stop speaking control to interrupt in that fallback mode. This must still be tested with real speakers, microphones and headsets.
- Browser security requires the user to select local files in the native file picker. Voxora can navigate to and focus the upload control but cannot silently read the computer's files.
- Voice-operated browser actions are restricted to visible controls and non-sensitive fields. Passwords are never filled by the assistant; the user must enter credentials directly.
- Uploaded resources require an authenticated Voxora account for search, preview, reading and download. A resource marked “public” is visible to signed-in members, not anonymous visitors. The public home page does not list uploaded resources.
- There is no password reset, account deletion, user export, malware scanning or independent security/accessibility audit.
- The privacy notice is a draft and must be reviewed against actual hosting, retention practices and applicable law before public launch.

This is a student project prototype, not a certified accessibility or security product.


## November 2026 access and voice refinements

- Added an echo-cancelled microphone monitor using browser media constraints and local voice-activity detection. The extra microphone stream is analyzed locally by Voxora and is not uploaded to the Voxora backend; speech recognition processing still depends on the browser's Web Speech implementation. Verbal interruption is accepted only when the processed microphone signal indicates near-end speech; browsers without reported echo cancellation use half-duplex playback/listening.
- Added speech-run identifiers so cancelled utterances cannot accidentally advance the queued response.
- Removed the persistent assistant panel below the footer. The bottom control dock remains fixed; contextual assistant status appears as a temporary, dismissible banner at the top only when there is something to report.
- Removed uploaded-resource discovery from the public home page.
- Required authentication for resource detail, preview, read, download, site-data and AI search operations. “Public” visibility now means visible to authenticated Voxora members.
- Added private/no-store cache headers to resource data and file responses.
