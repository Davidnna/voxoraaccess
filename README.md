# Voxora Access

Voxora Access is a voice-first digital accessibility and learning-resource platform designed to help visually impaired university students interact with online study materials. Its goal is to let students operate the website and explore learning content through natural speech, while keeping standard visual, keyboard and touch controls available.

## What the platform does

### Voice-operated website assistance

- Provides a persistent voice assistant that remains mounted while users move between React routes.
- Supports spoken navigation to public pages and signed-in workspace pages.
- Can describe, explain, summarise or read visible page and document content when asked.
- Can activate visible page controls, fill supported non-sensitive form fields, scroll pages and prepare the upload control.
- Supports voice interruption (barge-in) during spoken responses when the browser confirms echo cancellation. The independent microphone monitor uses a conservative voice-activity threshold, and playback-time transcripts are also compared with Voxora's current and recently spoken segments to reject likely self-echo. The monitor analyses audio locally and does not record or upload it. If echo cancellation is unavailable or cannot be confirmed, Voxora safely pauses recognition during playback and resumes afterward; the Stop speaking control remains available. The voice controls are rendered in a document-level portal and remain fixed to the bottom of the browser viewport while pages scroll.
- Uses the browser's speech recognition and speech synthesis capabilities. Microphone access requires the user's permission and a secure context (HTTPS, or localhost during development).
- Supports multi-step browser tasks such as navigating between pages, activating visible controls, filling supported fields, selecting dropdown options, setting ordinary checkboxes and submitting supported forms. Voxora checks whether browser actions succeeded before reporting completion; ambiguous controls stop the task rather than selecting an arbitrary match.

### Learning resources and document access

- Allows registered students to upload and manage learning resources.
- Supports PDF, DOCX, PPTX, TXT, MD, RTF, CSV, ODT, ODS and ODP uploads.
- Converts DOCX and PPTX uploads to PDF previews with LibreOffice when conversion is available; the original file remains available for download.
- Provides embedded previews for PDF, DOCX/PPTX-converted PDF, TXT, MD and CSV resources when the required preview data is available.
- Includes resource discovery, a personal library, private sharing between existing accounts, and public/private visibility settings.
- Extracts structured reading content from PDF, DOCX, PPTX, TXT, Markdown and CSV uploads. Scanned PDF pages can use local Tesseract OCR when the server's OCR engine and language data are installed.
- Provides a text-first document reading view with semantic headings, lists and tables, adjustable text size, and read-aloud support for all extracted text (up to the configured extraction limit), split into short speech segments. Resource owners can refresh the extracted reading structure for existing uploads after processing improvements.
- Preserves table header semantics only when the source format provides explicit evidence. DOCX repeat-header metadata is retained; CSV and PowerPoint tables are not assigned an assumed first-row header.
- Warns when text boxes, charts, diagrams, merged table cells, slide reading order, speaker notes or other embedded content may be missing from the extracted reading view.

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
- PostgreSQL for accounts, resource metadata, sharing records, library entries and uploaded file data, with a bounded per-worker connection pool and indexed resource-list queries. Flask emits server-side request timing logs and a `Server-Timing` response header with application, database-query and connection-pool timing where applicable; these measurements are not displayed in the student interface. Document previews use private ETag revalidation so the browser can reuse a previously fetched preview only after the authenticated server confirms it is unchanged.
- Groq's API for AI conversation and tool calling.
- Browser speech recognition and speech synthesis for voice input and spoken output.

## Run Voxora Access locally

### 1. Install the prerequisites

Install the following:

- Python 3.12 or later.
- Node.js and npm.
- PostgreSQL with an SSL-enabled connection, or a hosted PostgreSQL database such as Neon.
- LibreOffice Writer, Calc and Impress if you want DOCX, PPTX, RTF and OpenDocument uploads converted to PDF previews and text extraction.
- Tesseract OCR with the required language data (English is the default) if you want scanned PDF pages processed into selectable text.

On Debian or Ubuntu, LibreOffice and the fonts used by the deployment image can be installed with:

```bash
sudo apt-get update
sudo apt-get install -y libreoffice-writer libreoffice-calc libreoffice-impress tesseract-ocr tesseract-ocr-eng fonts-liberation fonts-dejavu-core
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
- `VOXORA_MAX_EXTRACTED_TEXT_CHARS`: maximum stored reading text per document; defaults to `200000`.
- `VOXORA_MAX_DOCUMENT_PAGES`: maximum PDF pages processed; defaults to `250`.
- `VOXORA_MAX_OCR_PAGES`: maximum sparse PDF pages sent to OCR per document; defaults to `6`.
- `VOXORA_OCR_LANG`: Tesseract language code; defaults to `eng`.
- `VOXORA_OCR_TIMEOUT_SECONDS`: OCR timeout per page; defaults to `5`.

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

Use localhost for microphone testing. On page load, Voxora checks whether microphone permission is already granted and resumes hands-free listening only in that case. If permission is not already granted, it waits for the user to select **Enable microphone** before requesting access. Speech recognition support differs between browsers; use a current browser with Web Speech API support for the best experience. On supported browsers, Voxora keeps recognition available during spoken responses only when the browser confirms echo cancellation on a separate microphone monitor. A local Web Audio analyser applies the V19 voice-activity threshold and requires sustained near-end speech before it corroborates an interruption. Recognition transcripts are additionally compared with the current and recent speech segments so Voxora does not act on words it has just spoken. A confirmed user utterance interrupts the current response; interim speech stops playback promptly, while the final transcript is processed as the command. If echo cancellation is not confirmed or the monitor cannot start, recognition pauses during playback and resumes afterward; use **Stop speaking** to stop speech manually in that fallback. The welcome is attempted on each full page load. Browsers may block automatic speech; when that happens, Voxora retries the pending welcome after the next eligible user interaction. There is no separate welcome replay or speaker-test button. If speech is not audible, check the device media volume, selected output device and browser audio settings.

## AI usage and rate limits

Voxora sends AI requests to Groq for conversational assistance and AI tool selection. Groq enforces model- and account-specific request and token quotas. When a quota is reached, Voxora displays the provider's available retry information and temporarily blocks repeated assistant requests. Local navigation and browser-side controls can continue to work without an AI request. Application-side optimisations reduce unnecessary context and tool cycles, but they cannot increase the quota assigned by Groq. The backend writes a `VOXORA_AI_USAGE` summary to the application log for each assistant interaction, including model passes, tool calls and the prompt, completion and total token counts reported by Groq. These measurements are for internal diagnostics and are not displayed in the student-facing interface. The backend only sends resource-management or browser-action tool definitions when the recent conversation indicates that those capabilities are relevant.

## Quality checks

Run the Python syntax validation and source/document-extraction regression checks locally:

```bash
python -m compileall -q app.py document_accessibility.py tests
python -m unittest discover -s tests -v
```

The GitHub Actions workflow in `.github/workflows/quality.yml` runs those checks, builds the production Vite frontend, and then runs a separate Chromium browser suite. The browser suite uses axe-core to check WCAG 2.2 AA and accessibility best-practice rules across public and authentication routes in both signed-in and signed-out states, plus workspace and document routes. It also checks skip-link focus, client-side route focus, persistent voice controls, form labels, document-preview alternatives, semantic document reading blocks, read-aloud/stop controls, element-level horizontal overflow, voice-dock spacing, full voice-control visibility near the footer, footer branding and scroll-control overlap at common viewport widths. Document extraction unit tests cover PDF, DOCX, PPTX, text, Markdown, CSV, RTF/OpenDocument conversion, image-description warnings, extraction limits and OCR fallback behavior. Browser-test dependencies are isolated under `tests/browser` and are not part of the production frontend dependencies.

To run the browser suite locally after building the frontend, install its test dependencies and Chromium:

```bash
npm install --no-audit --no-fund
npm run build
cd tests/browser
npm install --no-audit --no-fund
npx playwright install chromium
npm test
```

Automated browser checks do not establish complete WCAG conformance. They do not replace testing with NVDA, JAWS, Narrator and mobile screen readers, testing real uploaded documents, or evaluation with visually impaired students.

## Deployment

The repository includes a `Dockerfile` and `render.yaml` for deployment. The Render service builds the React frontend, installs the Python dependencies and starts Flask with Gunicorn. Configure `DATABASE_URL` and `GROQ_API_KEY` as secret environment variables in the hosting dashboard. Keep `VOXORA_HTTPS=1` in an HTTPS deployment and use a stable `VOXORA_SECRET_KEY` so user sessions remain valid across restarts.

## Current limitations

- Browser speech recognition and speech synthesis vary by browser, device and operating system. Voxora reports speaking after the browser fires the speech-start event, but that event cannot prove that the device physically emitted audible sound. If automatic welcome audio is blocked, Voxora retries it after the next eligible user interaction; there is no dedicated welcome replay or speaker-test control. Check device media volume, the selected output device and browser audio settings if speech is not audible. Microphone mute affects input only; it does not silence Voxora's spoken output. Where supported, Voxora uses a separate echo-cancelled microphone monitor as a local voice-activity gate while Web Speech recognition remains active. It also compares recognition text with the active and recent speech segments to reject likely playback echo. This is a best-effort browser audio design, not a guarantee that every device or acoustic environment will eliminate echo. If echo cancellation is not explicitly confirmed or the monitor is unavailable, Voxora falls back to half-duplex operation and voice interruption is unavailable until playback ends; the Stop speaking control remains available. The monitor stream is analysed locally and is not recorded or uploaded.
- A browser cannot silently browse a student's computer or choose a local file. Voxora can open or focus the upload control, but the student must select the file in the native file picker.
- Voxora does not fill password fields. Students enter their own credentials directly.
- DOCX/PPTX conversion depends on LibreOffice and may not preserve every complex layout, font, animation or embedded object. The original upload remains available if conversion fails.
- An embedded PDF preview is not automatically screen-reader accessible. The text-first reading view is an alternative generated from extracted content; it does not add tags to, repair or certify the original PDF.
- OCR can misrecognise characters and cannot reliably reconstruct complex reading order, mathematics, charts, diagrams or image descriptions. Verify OCR output against the original. The server limits OCR to a configurable number of sparse pages per document.
- Voxora read-aloud processes all text available in the extracted reading view, subject to the configured 200,000-character extraction limit. Long text is split at word boundaries into smaller speech segments. Source documents may still contain material that extraction did not capture.
- DOCX and PPTX extraction preserves common headings, paragraphs, lists and tables, but some embedded objects, SmartArt, charts, equations, comments, tracked changes, speaker notes and complex layout may not be represented. RTF and OpenDocument formats are converted through LibreOffice PDF previews, so semantic structure may be flattened.
- Existing uploads created before document extraction was introduced are marked as pending. The resource owner can use **Prepare / retry accessible text** or **Refresh accessible text** on the resource page to process them.
- Resource content and AI search require a signed-in account. Public visibility means visible to signed-in members, not anonymous visitors.
- The current project is a prototype and has not undergone an independent security, privacy or accessibility audit. Review the privacy and legal pages, hosting configuration, retention practices and applicable requirements before production use.


## Startup and health checks

The Render web service listens on `0.0.0.0:$PORT` and exposes `/healthz` as a lightweight HTTP liveness check. Gunicorn uses one worker by default on the Render free instance, with four request threads. PostgreSQL connections use a bounded eight-second connection timeout; startup logs identify schema initialization and connection-pool readiness. Configure `VOXORA_DB_CONNECT_TIMEOUT` only when a different bounded connection timeout is required.
