FROM python:3.11-slim-bookworm
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
COPY ml/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock
COPY ml ./ml
COPY data ./data
RUN useradd --uid 1000 --create-home thermoscan && mkdir -p /app/data/raw /app/data/uploads /app/.runtime && chown -R thermoscan:thermoscan /app
USER thermoscan
ENV PYTHONUNBUFFERED=1
CMD ["sh", "-c", "exec python -m uvicorn ml.service:app --host 0.0.0.0 --port ${PORT:-8000}"]
