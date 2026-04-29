# ─── Stage 1: Build frontend ──────────────────────────
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# ─── Stage 2: Python backend ──────────────────────────
FROM python:3.12-slim
WORKDIR /app

# System deps (just enough for psycopg2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# App code
COPY backend/app/ ./app/
COPY backend/alembic/ ./alembic/

# Frontend built files
COPY --from=frontend-build /app/frontend/dist/ ./static/

# Runtime
ENV PORT=8000
EXPOSE 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
