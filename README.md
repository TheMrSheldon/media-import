# media-import

A self-hosted web UI for importing media into a [Jellyfin](https://jellyfin.org) library. Search German public-broadcasting archives (ARD, ZDF, …) via [MediathekViewWeb](https://mediathekviewweb.de) or paste any direct video URL, look up IMDb metadata, then download, transcode with FFmpeg, and drop the file into your media library — all from the browser.

## Features

- Search MediathekViewWeb or import from any URL
- IMDb title lookup and autocomplete
- FFmpeg transcoding with configurable presets (HandBrake JSON format)
- Real-time progress via Server-Sent Events
- Supports movies and TV series (season/episode organisation)
- Single-binary deployment: Express serves both the API and the Svelte SPA

## Docker

```bash
docker run -d \
  -p 3000:3000 \
  -e MEDIA_IMPORT_MOVIE_BASE_DIR=/media/movies \
  -e MEDIA_IMPORT_SERIES_BASE_DIR=/media/series \
  -v /your/media/movies:/media/movies \
  -v /your/media/series:/media/series \
  -v /your/data:/data \
  ghcr.io/<owner>/media-import:latest
```

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MEDIA_IMPORT_MOVIE_BASE_DIR` | **yes** | — | Absolute path where movie files are placed |
| `MEDIA_IMPORT_SERIES_BASE_DIR` | **yes** | — | Absolute path where series files are placed |
| `MEDIA_IMPORT_TEMP_DIR` | no | `/tmp/media-import` | Working directory for downloads and transcoding |
| `MEDIA_IMPORT_DATA_DIR` | no | `/data` | Directory for job persistence (`jobs.json`) |
| `MEDIA_IMPORT_PRESET_PATH` | no | `./data/presets/default.json` | Path to a HandBrake-format transcoding preset |
| `PORT` | no | `3000` | HTTP listen port |
| `BASE_PATH` | no | `/` | URL path prefix (e.g. `/media-import` when running behind a reverse proxy at a sub-path) |

## Kubernetes example

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: media-import
spec:
  replicas: 1
  selector:
    matchLabels:
      app: media-import
  template:
    metadata:
      labels:
        app: media-import
    spec:
      containers:
        - name: media-import
          image: ghcr.io/<owner>/media-import:latest
          ports:
            - containerPort: 3000
          env:
            - name: MEDIA_IMPORT_MOVIE_BASE_DIR
              value: /media/movies
            - name: MEDIA_IMPORT_SERIES_BASE_DIR
              value: /media/series
            - name: MEDIA_IMPORT_TEMP_DIR
              value: /tmp/media-import
            - name: MEDIA_IMPORT_DATA_DIR
              value: /data
          volumeMounts:
            - name: movies
              mountPath: /media/movies
            - name: series
              mountPath: /media/series
            - name: data
              mountPath: /data
      volumes:
        - name: movies
          persistentVolumeClaim:
            claimName: movies-pvc
        - name: series
          persistentVolumeClaim:
            claimName: series-pvc
        - name: data
          persistentVolumeClaim:
            claimName: media-import-data-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: media-import
spec:
  selector:
    app: media-import
  ports:
    - port: 3000
      targetPort: 3000
```

If you serve the app at a sub-path via an Ingress (e.g. `https://example.com/media-import`), either:

- Configure your Ingress controller to **strip the prefix** before forwarding to the service (recommended), or
- Set `BASE_PATH=/media-import` in the container environment.

## Publishing

The [publish workflow](.github/workflows/publish.yml) runs on every push to `master`/`main` and on manual dispatch. It builds the image and pushes it to GHCR:

- If the commit carries a git tag (e.g. `v1.2.3`) → image is tagged with that version **and** `latest`
- Otherwise → image is tagged `nightly`

To trigger a versioned release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

## Development

```bash
# Requires Node 22+ and FFmpeg in PATH
npm install
cp .env.example .env   # edit paths
npm run dev            # backend :3000, Vite dev server :5173
```

Build and run as a single server:

```bash
npm run build
npm start
```
