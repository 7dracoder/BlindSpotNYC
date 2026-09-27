FROM node:22-bookworm-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
ARG VITE_GOOGLE_MAPS_API_KEY=""
ENV VITE_GOOGLE_MAPS_API_KEY=$VITE_GOOGLE_MAPS_API_KEY
RUN npm run build

FROM python:3.13-slim-bookworm AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.11.1 /uv /usr/local/bin/uv
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    FRONTEND_DIST=/app/frontend/dist \
    AUDIO_DIR=/app/backend/data/audio \
    PORT=8080
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-dev
COPY backend/app/ ./app/
COPY backend/scripts/ ./scripts/
COPY --from=frontend /build/frontend/dist /app/frontend/dist
RUN useradd --create-home --uid 10001 blindspot && mkdir -p data/audio && chown -R blindspot:blindspot /app
USER blindspot
EXPOSE 8080
CMD ["sh", "-c", "exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
