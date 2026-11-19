# Voxora Access

Voxora Access is a voice-first digital accessibility and learning-resource platform designed to help visually impaired university students access online study materials. It combines voice-operated website navigation, learning-resource management and structured document reading while retaining visual, keyboard and touch controls.

## Platform capabilities

### Voice assistant

- Persistent voice assistant across the React application.
- Spoken navigation across public pages and signed-in workspace pages.
- Assistance with understanding visible page content and extracted document text.
- Support for activating visible controls and completing supported, non-sensitive form actions.
- Browser speech recognition and speech synthesis for voice input and spoken output.
- Spoken interruption during playback where the browser confirms the required echo-cancellation support. Voxora applies local microphone activity checks and transcript-to-speech comparison to reduce self-echo. When the required support is unavailable, it uses a safer listen-after-speaking fallback.
- Voice controls remain fixed to the bottom of the browser viewport while the user scrolls.

Microphone access requires user permission and a secure browser context (HTTPS or `localhost`). Speech-recognition support and audio behaviour vary by browser, operating system and device.

### Learning resources and accounts

- Student registration, sign-in and sign-out.
- Upload and management of learning resources.
- Personal library and resource discovery.
- Private sharing between existing accounts.
- Public and private resource visibility. Public resources are visible to signed-in Voxora members; they are not available to signed-out visitors.
- Server-side ownership and access checks for protected resources.
- Confirmation before permanently deleting a resource.

Supported upload formats:

- PDF
- DOCX
- PPTX
- TXT
- Markdown (`.md`)
- CSV
- RTF
- ODT, ODS and ODP

### Document processing and accessible reading

- Structured text extraction for PDF, DOCX, PPTX, TXT, Markdown and CSV.
- Local Tesseract OCR fallback for supported scanned PDF pages.
- LibreOffice conversion for office and OpenDocument formats where the conversion tools are installed.
- PDF previews for supported converted documents, while preserving the original upload for download.
- Text-first reading views with headings, nested lists, tables and available image descriptions.
- Read-aloud controls and adjustable speech rate for extracted document content.
- Word heading and list hierarchy preservation where the source document exposes the relevant structure.
- Explicit Word table headers and detected merged-cell spans.
- PowerPoint list levels, merged table spans and available speaker notes.
- Word footnotes and endnotes in separate sections after the main document text.

Document extraction can omit or flatten complex content. It does not repair, tag, certify or guarantee the accessibility of the original file. See [Known limitations](#known-limitations).

## Technology

| Layer | Technology |
|---|---|
| Backend and HTTP API | Python 3.12, Flask |
| Database | PostgreSQL, Psycopg 3 and Psycopg connection pool |
| Frontend | React 19, React Router |
| Frontend build | Vite |
| Voice input/output | Browser Web Speech APIs |
| AI assistant | Groq API |
| PDF extraction | pypdf |
| Word extraction | python-docx |
| PowerPoint extraction | python-pptx |
| OCR | Tesseract through pytesseract and Pillow |
| Office conversion | LibreOffice |
| Production server | Gunicorn |
| Hosting configuration | Render Blueprint (`render.yaml`) or Docker |

## Repository structure

```text
voxoraaccess/
├── .github/
│   └── workflows/             # Automated quality and formatting workflows
├── src/
│   ├── components/
│   │   └── VoiceAssistant.jsx # Persistent voice assistant
│   ├── data/                  # Navigation and page content
│   ├── styles/
│   │   └── app.css            # React application styles
│   ├── App.jsx                # React routes and application views
│   └── main.jsx               # React entry point
├── static/
│   ├── img/                   # Shared brand assets
│   └── dist/                  # Generated Vite output; not committed
├── templates/
│   └── spa.html               # Single Flask/Jinja shell for the React app
├── tests/
│   ├── browser/               # Playwright and axe browser tests
│   ├── test_accessibility_contracts.py
│   ├── test_document_accessibility.py
│   └── test_project_integrity.py
├── app.py                     # Flask application and API entry point
├── document_accessibility.py  # Document extraction and conversion logic
├── index.html                 # Vite build entry
├── package.json               # Frontend dependencies and build command
├── requirements.txt           # Python dependencies
├── render.yaml                # Render service configuration
├── Dockerfile                 # Multi-stage container build
├── apt.txt                    # System packages for Render's native runtime
├── vite.config.js             # Vite output configuration
├── pyproject.toml              # Python formatter configuration
├── .env.example                # Environment variable template
├── .gitignore
├── .dockerignore
├── .editorconfig
└── README.md                   # Project documentation and setup guide
```

`static/dist/` is generated by Vite during the frontend build. Do not edit it manually or commit it. The Flask `render_template` wrapper sends browser routes through the single `templates/spa.html` React shell. The browser test suite has its own `package.json` because Playwright and axe are development-only dependencies and are kept separate from the production frontend.

## Requirements

Install the following before running the application locally:

- Python 3.12 or later.
- Node.js 22 or later and npm.
- PostgreSQL.
- Git.
- LibreOffice for DOCX, PPTX, RTF and OpenDocument PDF conversion.
- Tesseract OCR and the required language data for scanned-PDF OCR.

LibreOffice and Tesseract are optional at runtime, but document conversion and OCR features will be unavailable or limited if their executables or language data are missing.

On Debian or Ubuntu, install the document-processing system packages with:

```bash
sudo apt-get update
sudo apt-get install -y \
  libreoffice-writer \
  libreoffice-calc \
  libreoffice-impress \
  tesseract-ocr \
  tesseract-ocr-eng \
  fonts-liberation \
  fonts-dejavu-core
```

On Windows, install PostgreSQL, LibreOffice and Tesseract using their platform installers. Ensure `psql`, `libreoffice` (or `soffice`) and `tesseract` are available on `PATH` if you intend to use those features.

## Run Voxora Access locally

### 1. Clone the repository

```bash
git clone https://github.com/Davidnna/voxoraaccess.git
cd voxoraaccess
```

### 2. Create a PostgreSQL database

Create a database and a login role for the application. For example, open the PostgreSQL shell as an administrator:

```sql
CREATE ROLE voxora_user WITH LOGIN PASSWORD 'replace-with-a-strong-password';
CREATE DATABASE voxora_access OWNER voxora_user;
```

Use the resulting connection string in the environment configuration:

```text
postgresql://voxora_user:replace-with-a-strong-password@localhost:5432/voxora_access
```

For a local PostgreSQL server without TLS, set `VOXORA_DB_SSLMODE=disable`. Hosted PostgreSQL services such as Neon normally require `VOXORA_DB_SSLMODE=require`.

### 3. Create a Python virtual environment

Linux or macOS:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Install frontend dependencies and build the application

Run from the repository root:

```bash
npm install
npm run build
```

Vite compiles the React application into `static/dist/`. Flask serves these generated assets. Re-run `npm run build` after changing files under `src/`, `index.html` or `vite.config.js`.

### 5. Configure environment variables

The application reads environment variables from the process environment. It does not automatically load `.env`; `.env.example` is a reference template, not an automatic configuration loader. Copy its values into your terminal, IDE run configuration or hosting dashboard.

| Variable | Required | Default | Purpose |
|---|---:|---|---|
| `DATABASE_URL` | Yes | None | PostgreSQL connection string. |
| `VOXORA_SECRET_KEY` | Strongly recommended | Generated at startup if absent | Stable Flask session-signing secret. Set a persistent value so sessions remain valid across restarts. |
| `VOXORA_DB_SSLMODE` | No | `require` | PostgreSQL TLS mode. Use `disable` for a local non-TLS database; use `require` for hosted PostgreSQL. |
| `VOXORA_DB_CONNECT_TIMEOUT` | No | `8` | Database connection timeout in seconds. |
| `GROQ_API_KEY` | No | None | Enables AI assistant requests. Without it, non-AI application features remain available. |
| `VOXORA_MAX_UPLOAD_MB` | No | `20` | Maximum upload size in megabytes. |
| `VOXORA_HTTPS` | No | `1` | Set to `0` for local HTTP development; keep `1` behind production HTTPS. |
| `VOXORA_DEBUG` | No | `0` | Enables Flask debug mode only when explicitly set to `1`. |
| `VOXORA_MAX_EXTRACTED_TEXT_CHARS` | No | `200000` | Maximum extracted reading text stored per document. |
| `VOXORA_MAX_DOCUMENT_PAGES` | No | `250` | Maximum PDF pages processed. |
| `VOXORA_MAX_OCR_PAGES` | No | `6` | Maximum sparse PDF pages sent to OCR per document. |
| `VOXORA_OCR_LANG` | No | `eng` | Tesseract language code. |
| `VOXORA_OCR_TIMEOUT_SECONDS` | No | `5` | OCR timeout per page. |
| `PORT` | Hosting-provided | Flask local default `5000`; Docker fallback `10000` | HTTP port used by the server. |

Generate a secret key:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Linux or macOS example:

```bash
export DATABASE_URL='postgresql://voxora_user:your-password@localhost:5432/voxora_access'
export VOXORA_DB_SSLMODE=disable
export VOXORA_SECRET_KEY='paste-the-generated-secret-here'
export VOXORA_HTTPS=0
export VOXORA_DEBUG=0
export GROQ_API_KEY='your-groq-api-key'
```

Windows PowerShell example:

```powershell
$env:DATABASE_URL = 'postgresql://voxora_user:your-password@localhost:5432/voxora_access'
$env:VOXORA_DB_SSLMODE = 'disable'
$env:VOXORA_SECRET_KEY = 'paste-the-generated-secret-here'
$env:VOXORA_HTTPS = '0'
$env:VOXORA_DEBUG = '0'
$env:GROQ_API_KEY = 'your-groq-api-key'
```

`GROQ_API_KEY` may be omitted if AI assistant functionality is not needed. Never commit real credentials or place them in `.env.example`.

### 6. Start the Flask application

With the Python virtual environment active and environment variables configured in the same terminal:

```bash
flask --app app run --host 127.0.0.1 --port 5000
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000).

The application initializes its database schema when the Flask module starts. The database must be reachable before the server starts.

Use `localhost` or `127.0.0.1` for local microphone testing. Browser microphone access requires a secure context and user permission. Use a current browser that supports the Web Speech APIs for voice recognition and speech synthesis.

## Run tests

Run the backend syntax and regression suite from the repository root:

```bash
python -m compileall -q app.py document_accessibility.py tests
python -m unittest discover -s tests -v
```

Build the frontend:

```bash
npm run build
```

Run the Playwright and axe browser suite:

```bash
cd tests/browser
npm install --no-audit --no-fund
npx playwright install chromium
npm test
```

The browser suite checks application routes, responsive layout and selected accessibility contracts. GitHub Actions runs the backend tests, frontend production build and browser suite on pushes and pull requests to `main`.

Automated checks do not establish complete WCAG conformance. They do not replace testing with NVDA, JAWS, Narrator and mobile screen readers, testing representative uploaded documents, or evaluation with visually impaired students.

## Deploy to Render

The repository includes `render.yaml` for Render's native Python runtime.

1. Push the repository to GitHub.
2. In Render, create a new Blueprint and select the repository.
3. Allow Render to read `render.yaml` and configure the service.
4. Set `DATABASE_URL` to the production PostgreSQL connection string.
5. Set `GROQ_API_KEY` if AI assistant functionality is required.
6. Keep `VOXORA_DB_SSLMODE=require` and `VOXORA_HTTPS=1` for the hosted service.
7. Deploy and check the `/healthz` endpoint.

The Render build command installs the Python and frontend dependencies and runs the Vite production build. `apt.txt` lists the system packages needed for LibreOffice conversion and Tesseract OCR. Render generates `VOXORA_SECRET_KEY` through the Blueprint configuration.

Do not use a local database URL in the hosted service. The production database must be reachable from Render.

## Build and run with Docker

The Dockerfile uses a multi-stage build: Node.js compiles the frontend in the build stage, while the final Python image contains only the runtime and document-processing system packages.

Build:

```bash
docker build -t voxora-access .
```

Run with an externally hosted PostgreSQL database:

```bash
docker run --rm \
  -p 10000:10000 \
  -e PORT=10000 \
  -e DATABASE_URL='your-reachable-postgresql-connection-string' \
  -e VOXORA_SECRET_KEY='your-persistent-secret' \
  -e VOXORA_DB_SSLMODE=require \
  -e VOXORA_HTTPS=1 \
  -e GROQ_API_KEY='your-groq-api-key' \
  voxora-access
```

The database hostname must be reachable from inside the container. Do not use `localhost` for a database running on the host machine unless the container is configured with the appropriate host-gateway address.

## Known limitations

- Browser speech recognition and synthesis differ across browsers and devices. Echo cancellation and spoken interruption are best-effort capabilities; when the required browser support is unavailable, Voxora uses a safer listen-after-speaking fallback.
- OCR can misrecognise text and cannot reliably reconstruct complex reading order, mathematics, charts, diagrams or image descriptions. Verify OCR output against the original document.
- PDF layout-aware extraction does not validate the PDF tag tree or guarantee correct reading order for complex multi-column or floating layouts.
- DOCX and PPTX extraction preserves common structures but may omit or flatten embedded objects, SmartArt, charts, equations, comments, tracked changes, floating text boxes and other complex content.
- Word footnotes and endnotes are presented after the main document text; their original inline reference positions are not recreated.
- PowerPoint speaker notes are included after slide content when available. They may contain presenter-only information and should be reviewed before sharing.
- LibreOffice conversion may not preserve every font, layout, animation or embedded object. The original uploaded file remains available for download.
- Existing uploads keep their stored extracted content until their owner refreshes or reprocesses the accessible reading view.
- An embedded PDF preview is not automatically screen-reader accessible. The text-first reading view is an alternative based on extracted content; it does not add tags to or repair the original PDF.
- Resource content and AI search require a signed-in account. Public visibility means visible to signed-in members, not anonymous visitors.
- Voxora Access has not undergone an independent security, privacy or accessibility audit. Review deployment security, privacy, retention and applicable requirements before production use.

## Operational notes

- `/healthz` is the lightweight HTTP health-check endpoint.
- Gunicorn runs with one worker and four request threads by default in the Render configuration.
- PostgreSQL connections use a bounded per-worker pool and a configurable connection timeout.
- Generated frontend files are written to `static/dist/` at build time and should not be edited or committed.
- Uploaded files and resource metadata are stored in PostgreSQL by the current application schema. Back up the database according to the hosting provider's recommended procedures.
