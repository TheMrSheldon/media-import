# Build Container
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production Container
FROM node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY package*.json ./
RUN npm ci --omit=dev

ENV PORT=3000 \
    BASE_PATH=/ \
    MEDIA_IMPORT_TEMP_DIR=/tmp/media-import \
    MEDIA_IMPORT_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist/index.js"]
