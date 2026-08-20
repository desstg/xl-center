# XL Center

An **Emby-style local media center manager** designed for video libraries that are already scraped with NFO metadata. It scans local folders, imports movies (posters, plot, cast, tags, IDs, etc.) into a database, and provides a poster wall, detail pages, multi-faceted search, and in-browser playback.

- Backend: Node.js + TypeScript + Express + SQLite (better-sqlite3)
- Frontend: Vue 3 + Vite (dark glassmorphism UI)
- Deployment: Docker (works on Synology NAS and any Docker-capable device)

---

## ✨ Features

- **Poster wall + detail pages**: vertical poster and horizontal thumbnail views; detail pages show poster/fanart/stills, plot, cast, tags, genres, ID (番号), codec, etc.
- **Multi-faceted search**: filter by title / ID / actor / tag / genre / filename / year / library, with "match all" and "match any" modes.
- **In-browser playback**: H264 direct play, HEVC transcoding (HLS), and STRM stream proxying.
- **Actor normalization**: merge multiple aliases of the same actor into one canonical name via `mapping_actor.xml`.
- **Library management**: add/remove libraries, manual scan, and automatic incremental scan from the web UI.
- **NFO editing / poster cropping**: edit metadata and write back to NFO files, or crop posters directly in the browser.
- **Bitrate / download-speed display**: the player shows the video bitrate and real-time download speed.
- **Optional login**: no password by default; enable username/password login via environment variables.

---

## 🚀 Quick Start (Docker)

### 1. Prepare your media library

Make sure your video library uses a "one movie per folder" structure (see [Media library preparation](#media-library-preparation) below).

### 2. Create a `docker-compose.yml`

```yaml
services:
  xl-center:
    image: desstg/xl-center:latest
    container_name: xl-center
    ports:
      - "8899:8899"
    volumes:
      - ./data:/app/data                # persistent data (SQLite DB + thumbnail cache)
      - /volume1/media:/media           # ← change to your own media directory (host path)
    environment:
      # Optional login (both required to enable): leave unset for no login
      # - AUTH_USERNAME=admin
      # - AUTH_PASSWORD=admin123
    devices:
      # Intel GPU passthrough for VAAPI hardware transcoding (optional — remove if no iGPU)
      - /dev/dri:/dev/dri
    restart: unless-stopped
```

### 3. Start it

```bash
docker compose up -d
```

### 4. Open the web UI

Visit `http://<your-device-ip>:8899`

### 5. Add a library and scan

1. Go to the top nav: **Manage → Libraries**
2. Click **Add Library**, give it a name (e.g. "Movies"), and set the path to the **container-internal path `/media`**
3. Save, then click **Scan** — the poster wall will populate when done.

> ⚠️ **Important**: in the web UI you must enter the **container-internal path `/media`**, not the host path. The host path is mapped in `docker-compose.yml` via the left side of the `volumes` entry; the right side `/media` stays fixed.

---

## 📁 Media library preparation

The scanner recursively finds folders containing video files; each such folder is treated as one movie. Recommended structure:

```
media/
├── MovieA/
│   ├── MovieA.mkv              # video (also mp4 / avi / ts / m2ts / webm / mov / m4v / flv / wmv / strm)
│   ├── MovieA.nfo              # Kodi-standard movie NFO (or movie.nfo)
│   ├── poster.jpg              # poster (portrait)
│   ├── fanart.jpg              # fanart / backdrop
│   ├── thumb.jpg               # thumbnail
│   ├── logo.png                # logo (optional)
│   ├── subtitles.srt           # subtitles (srt / ass / ssa / sub / vtt)
│   └── extrafanart/            # stills directory (optional)
│       ├── 1.jpg
│       └── 2.jpg
├── MovieB/
│   └── ...
```

- **Video formats**: `.mp4` `.mkv` `.avi` `.ts` `.m2ts` `.webm` `.mov` `.m4v` `.flv` `.wmv` `.strm`
- **Subtitle formats**: `.srt` `.ass` `.ssa` `.sub` `.vtt`
- **Image formats**: `.jpg` `.jpeg` `.png` `.webp`
- **NFO**: standard Kodi `movie.nfo` (root node `<movie>`), supporting `title`, `num`, `originaltitle`, `year`, `plot`, `outline`, `rating`, `votes`, `runtime`, `mpaa`, `premiered`, `trailer`, `genre`, `tag`, `country`, `studio`, `director`, `credits`, `actor`, etc.

If a movie folder has no NFO, the movie is still imported with the folder name as its title (other metadata empty).

---

## 🌐 STRM streaming

A `.strm` file is a plain-text file containing a single stream URL (HTTP/HTTPS). On playback, the backend reads that URL and proxies the stream to the browser.

```
http://192.168.1.100:5244/d/xxx.mp4   # e.g. an alist / cms direct link
```

**Notes**:

- The URL inside the STRM must be reachable **from inside the container** (public URL, or a LAN address on the same network as the container).
- ⚠️ Do not use `localhost` / `127.0.0.1` — inside a container those refer to the container itself, not the host.
- The backend follows 302 redirects automatically (common with alist links), so external browsers don't need direct access to internal addresses.

---

## 🎬 Playback & transcoding

| Video type | Playback |
|-----------|----------|
| H264 (incl. 4K) | Direct play, no transcoding |
| HEVC 1080p | VAAPI hardware transcode (with Intel iGPU) or software transcode |
| HEVC 4K | Requires a capable Intel iGPU (e.g. UHD 630 / Iris Xe) for hardware transcode; otherwise falls back to direct play (may not play) |

Transcoding relies on **Intel GPU VAAPI** and requires:

1. An Intel iGPU on the host
2. `/dev/dri` passthrough in `docker-compose.yml`
3. ffmpeg + Intel iHD driver (already bundled in the image)

Without an iGPU the app still works (H264 direct play, HEVC 1080p software transcode); only HEVC 4K won't play. VAAPI devices are auto-detected at startup — used if available, gracefully downgraded otherwise.

---

## 🔐 Login (optional)

By default there is **no login** — the web UI opens directly. To enable username/password login, set two environment variables:

```yaml
environment:
  - AUTH_USERNAME=admin
  - AUTH_PASSWORD=admin123
```

- Both set → login is required to access the UI
- Empty / unset → no login, direct access

Login uses in-memory tokens (invalidated on restart); the session is stored in the browser's localStorage.

---

## ⚙️ Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `AUTH_USERNAME` | No | empty | Login username (only effective together with `AUTH_PASSWORD`) |
| `AUTH_PASSWORD` | No | empty | Login password |
| `XL_DATA_DIR` | No | `/app/data` | Data directory (database + thumbnails) |
| `FFMPEG_PATH` | No | auto | Path to the ffmpeg binary |
| `FFPROBE_PATH` | No | auto | Path to the ffprobe binary |
| `LIBVA_DRIVER_NAME` | No | `iHD` | VAAPI driver name (use `iHD` for Intel iGPU) |

---

## 🗂️ Directories / mounts

| Path | Description |
|------|-------------|
| `/app/data` | Database (`xlcenter.db`) + thumbnail cache — mount persistently |
| `/media` | Media library mount point (example; the web UI path should match the container path) |
| `/app/config.json` | Site config (port, host, etc. — usually no change needed) |
| `/app/mapping_actor.xml` | Actor alias mapping (optional, for actor normalization) |

---

## ❓ FAQ

**Q: The poster wall is empty after scanning?**
A: Check that the library path entered in the web UI is the container-internal path `/media` (not the host path), and that the library uses "one movie per folder" structure.

**Q: HEVC 4K won't play?**
A: This is a hardware limitation. HEVC 4K transcoding requires a capable Intel iGPU; if yours is insufficient, hardware transcoding won't work. H264 is unaffected.

**Q: STRM won't play?**
A: Confirm the STRM file contains a URL reachable from inside the container (not `localhost`), and that the URL is valid.

**Q: How do I upgrade?**
A: `docker compose pull && docker compose up -d`. Your data lives in the `/app/data` volume, so upgrading won't lose it.

**Q: Are TV series supported?**
A: Currently only movie libraries are supported; TV series scanning is still under development.

---

## 📄 License

For personal learning and private use only.
