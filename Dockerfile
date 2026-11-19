FROM node:22-slim AS frontend-build

WORKDIR /build
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY index.html vite.config.js ./
COPY src ./src
RUN npm run build


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \\
    PYTHONUNBUFFERED=1 \\
    DEBIAN_FRONTEND=noninteractive \\
    VOXORA_DB_SSLMODE=require

RUN apt-get update \\
    && apt-get install -y --no-install-recommends \\
        libreoffice-writer \\
        libreoffice-calc \\
        libreoffice-impress \\
        tesseract-ocr \\
        tesseract-ocr-eng \\
        fonts-liberation \\
        fonts-dejavu-core \\
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py document_accessibility.py ./
COPY templates ./templates
COPY static ./static
COPY --from=frontend-build /build/static/dist ./static/dist

CMD ["sh", "-c", "exec gunicorn --workers ${WEB_CONCURRENCY:-1} --threads 4 --timeout 120 --log-level info --capture-output --bind 0.0.0.0:${PORT:-10000} app:app"]
