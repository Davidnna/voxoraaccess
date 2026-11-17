# Voxora Access

Voxora Access is a voice-first digital accessibility and learning-resource platform designed to help visually impaired university students interact with online study materials. Its goal is to let students operate the website and explore learning content through natural speech, while keeping standard visual, keyboard and touch controls available.

## What the platform does

### Voice-operated website assistance

- Provides a persistent voice assistant that remains mounted while users move between React routes.
- Supports spoken navigation to public pages and signed-in workspace pages.
- Can describe, explain, summarise or read visible page and document content when asked.
- Can activate visible page controls, fill supported non-sensitive form fields, scroll pages and prepare the upload control.
- Supports spoken interruption where the browser's audio capabilities allow it, with always-visible microphone, mute, pause and stop-speaking controls.
- Uses the browser's speech recognition and speech synthesis capabilities. Microphone access requires the user's permission and a secure context (HTTPS, or localhost during development).
- Supports multi-step browser tasks such as navigating between pages, activating visible controls, filling supported fields, selecting dropdown options, setting ordinary checkboxes and submitting supported forms. Voxora checks whether browser actions succeeded before reporting completion; ambiguous controls stop the task rather than selecting an arbitrary match.

### Learning resources and document access

- Allows registered students to upload and manage learning resources.
- Supports PDF, DOCX, PPTX, TXT, MD, RTF, CSV, ODT, ODS and ODP uploads.
- Converts DOCX and PPTX uploads to PDF previews with LibreOffice when conversion is available; the original file remains available for download.
- Provides embedded previews for PDF, DOCX/PPTX-converted PDF, TXT, MD and CSV resources when the required preview data is available.
- Provides embedded previews for supported formats. The current upload pipeline does not populate extracted document text, so resource search is based on titles and descriptions; AI explanations of document contents depend on text made available through the current page or document viewer.
- Includes resource discovery, a personal library, private sharing between existing accounts, and public/private visibility settings.

### Accounts and resource permissions

- Provides student registration, sign-in and sign-out.
- Separates each student's uploads, saved library and resources shared with them.
- Checks resource access and ownership on the server before returning protected content or performing resource-management actions.
- Requires explicit confirmation before Voxora permanently deletes a resource.
- Treats a resource marked **public** as visible to signed-in Voxora members; uploaded resources are not available to signed-out visitors.

### Application technology

- React 19 and React Router for the browser application and client-side navigation.
- Vite for building the frontend assets.
- Flask for the backend, server-rendered application shell and JSON APIs.
- PostgreSQL for accounts, resource metadata, sharing records, library entries and uploaded file data, with a bounded per-worker connection pool and indexed resource-list queries. Flask emits server-side request timing logs and a `Server-Timing` response header for performance diagnostics; these measurements are not displayed in the student interface.
- Groq's API for AI conversation and tool calling.
- Browser speech recognition and speech synthesis for voice input and spoken output.

## Run Voxora Access locally

### 1. Install the prerequisites

Install the following:

- Python 3.12 or later.
- Node.js and npm.
- PostgreSQL with an SSL-enabled connection, or a hosted PostgreSQL database such as Neon.
- LibreOffice Writer and Impress if you want DOCX and PPTX uploads converted to PDF previews.

On Debian or Ubuntu, LibreOffice and the fonts used by the deployment image can be installed with:

```bash
sudo apt-get update
sudo apt-get install -y libreoffice-writer libreoffice-impress fonts-liberation fonts-dejavu-core
```

### 2. Get the source code

Clone the repository and enter the project directory:

```bash
git clone https://github.com/Davidnna/voxoraaccess.git
cd voxoraaccess
```

### 3. Create a Python environment and install backend dependencies

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

### 4. Install frontend dependencies and build React

Run these commands from the project directory:

```bash
npm install
npm run build
```

The Vite build writes the production frontend assets to `static/dist`. Flask serves the built application; run the build again after changing frontend source files.

### 5. Configure environment variables

The application reads configuration from environment variables. It does **not** automatically load a `.env` file, so set the variables in the terminal or configure them in your development environment.

Required:

- `DATABASE_URL`: PostgreSQL connection string. The application connects with `sslmode=require`; use a database endpoint that supports SSL.
- `VOXORA_SECRET_KEY`: a long, random secret used to sign Flask sessions.

For AI voice assistance:

- `GROQ_API_KEY`: an API key for the Groq project and model configured by the backend. Without this key, the website's non-AI features can run, but AI assistant requests will be unavailable.

Optional:

- `VOXORA_MAX_UPLOAD_MB`: maximum upload size in megabytes; defaults to `20`.
- `VOXORA_HTTPS`: set to `0` for local HTTP development. Use `1` when deployed behind HTTPS; the default is `1`.

Generate a secret key with Python:

```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

Linux or macOS example (replace the placeholder values):

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require'
export VOXORA_SECRET_KEY='paste-a-generated-random-secret-here'
export GROQ_API_KEY='your-groq-api-key'
export VOXORA_HTTPS=0
export VOXORA_MAX_UPLOAD_MB=20
```

Windows PowerShell example:

```powershell
$env:DATABASE_URL = 'postgresql://USER:PASSWORD@HOST/DBNAME?sslmode=require'
$env:VOXORA_SECRET_KEY = 'paste-a-generated-random-secret-here'
$env:GROQ_API_KEY = 'your-groq-api-key'
$env:VOXORA_HTTPS = '0'
$env:VOXORA_MAX_UPLOAD_MB = '20'
```

Keep real credentials out of source control. The `.env.example` file contains placeholders only; do not put production secrets in it.

### 6. Start the application

With the Python virtual environment active and environment variables set in the same terminal, run:

```bash
flask --app app run --host 127.0.0.1 --port 5000
```

Open [http://127.0.0.1:5000](http://127.0.0.1:5000) in a browser. The application creates its database tables when the Flask application starts.

Use localhost for microphone testing. The browser will ask for microphone permission before voice input can begin. Speech recognition support differs between browsers; use a current browser with Web Speech API support for the best experience.

## AI usage and rate limits

Voxora sends AI requests to Groq for conversational assistance and AI tool selection. Groq enforces model- and account-specific request and token quotas. When a quota is reached, Voxora displays the provider's available retry information and temporarily blocks repeated assistant requests. Local navigation and browser-side controls can continue to work without an AI request. Application-side optimisations reduce unnecessary context and tool cycles, but they cannot increase the quota assigned by Groq. The backend writes a `VOXORA_AI_USAGE` summary to the application log for each assistant interaction, including model passes, tool calls and the prompt, completion and total token counts reported by Groq. These measurements are for internal diagnostics and are not displayed in the student-facing interface. The backend only sends resource-management or browser-action tool definitions when the recent conversation indicates that those capabilities are relevant.

## Quality checks

Run the dependency-free source regression checks and Python syntax validation locally:

```bash
python -m compileall -q app.py tests
python -m unittest discover -s tests -v
```

The GitHub Actions workflow in `.github/workflows/quality.yml` runs those checks and then installs the frontend dependencies and performs a production Vite build on pushes and pull requests targeting `main`. The source regression checks cover critical project conventions and code contracts, including database-pool configuration and consolidated resource-preview queries; they are not a substitute for database-backed integration tests, browser automation or accessibility testing with assistive technology.

## Deployment

The repository includes a `Dockerfile` and `render.yaml` for deployment. The Render service builds the React frontend, installs the Python dependencies and starts Flask with Gunicorn. Configure `DATABASE_URL` and `GROQ_API_KEY` as secret environment variables in the hosting dashboard. Keep `VOXORA_HTTPS=1` in an HTTPS deployment and use a stable `VOXORA_SECRET_KEY` so user sessions remain valid across restarts.

## Current limitations

- Browser speech recognition and speech synthesis vary by browser, device and operating system. Voice interruption and echo handling depend on the audio capabilities exposed by the browser and hardware.
- A browser cannot silently browse a student's computer or choose a local file. Voxora can open or focus the upload control, but the student must select the file in the native file picker.
- Voxora does not fill password fields. Students enter their own credentials directly.
- DOCX/PPTX conversion depends on LibreOffice and may not preserve every complex layout, font, animation or embedded object. The original upload remains available if conversion fails.
- An embedded PDF preview is not automatically screen-reader accessible. Accessibility depends on the source document's text, structure, tags and reading order; scanned PDFs may require OCR.
- Resource content and AI search require a signed-in account. Public visibility means visible to signed-in members, not anonymous visitors.
- The current project is a prototype and has not undergone an independent security, privacy or accessibility audit. Review the privacy and legal pages, hosting configuration, retention practices and applicable requirements before production use.
