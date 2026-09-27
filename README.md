# BlindSpot NYC

**See the building records that a rental listing leaves out.**

BlindSpot NYC turns New York City's public building records into an interactive risk report. Search an address or select a building on the map to explore fire and egress violations, long-running sidewalk sheds, heat and sewer complaints, and the history behind them. The app explains its score, writes a plain-English briefing, and can read that briefing aloud or answer questions through a voice inspector.

[Source code](https://github.com/7dracoder/BlindSpotNYC) · [NYC Open Data](https://opendata.cityofnewyork.us/) · [Deployment configuration](.do/app.yaml)

> BlindSpot is a screening tool built from public records. Its score is a project-defined index, not an official city rating or a probability of harm. Missing records and a low score do not establish that a building is safe.

## Contents

- [What the app does](#what-the-app-does)
- [Architecture and request flow](#architecture-and-request-flow)
- [Technology stack](#technology-stack)
- [Public data sources](#public-data-sources)
- [How scoring works](#how-scoring-works)
- [Run locally](#run-locally)
- [Environment variables](#environment-variables)
- [Google 3D map setup and troubleshooting](#google-3d-map-setup-and-troubleshooting)
- [API reference](#api-reference)
- [Optional integrations](#optional-integrations)
- [Deploy to DigitalOcean](#deploy-to-digitalocean)
- [Repository layout](#repository-layout)
- [Verification and development](#verification-and-development)
- [Data limits and operational considerations](#data-limits-and-operational-considerations)

## What the app does

- **Address search:** Autocomplete NYC addresses and resolve each building to a Building Identification Number (BIN), tax-lot identifier (BBL), and coordinates.
- **Two map views:** Explore Google's Photorealistic 3D Tiles or the City map built with Blocklight and MapLibre. Switch between 2D and 3D, pan, zoom, and rotate with modifier-key dragging.
- **Explainable risk report:** View a 0–100 score, a LOW/MODERATE/HIGH label, the component scores, violation counts, complaint counts, and sidewalk-shed age.
- **X-ray overlays:** Inspect red fire/egress markers, blue heat and flood complaint markers, and an orange sidewalk-shed outline around the selected building.
- **Citywide layers:** Color City-map buildings by unsafe facades, active sheds, vacate orders, rat activity, or heat complaints. Show Sandy inundation and hurricane evacuation zones in either map view.
- **Briefing and audio:** Read a short tenant briefing generated from the retrieved records, with a rules-based fallback. Listen to an audio version when a TTS provider is configured.
- **Voice inspector:** Ask an ElevenLabs conversational agent about the selected building's report, using speech or the suggested questions.
- **Historical context:** View ten calendar years of heat/flood complaints and matching press or listing coverage.
- **Previously scanned buildings:** Open nearby reports from the application's cache.
- **Shareable reports:** The `?q=<address>` URL opens and scans an address directly.
- **Optional iMessage access:** A separate Photon Spectrum agent accepts addresses and replies with the report and a web-map link.

## Architecture and request flow

```mermaid
flowchart LR
    Browser[React web app] --> API[FastAPI]
    Browser --> Google[Google Photorealistic 3D Tiles]
    API --> Geo[NYC GeoSearch]
    API --> NYC[NYC Open Data / Socrata]
    API <--> Mongo[MongoDB Atlas cache]
    API <--> Tiger[Tiger Cloud / TimescaleDB]
    API --> LLM[Gemini or Grok]
    API --> News[Tavily search]
    API --> Voice[ElevenLabs / Grok TTS]
    Photon[Photon iMessage agent] --> API
```

A scan follows this sequence:

1. **Resolve the address.** NYC GeoSearch returns a BIN, BBL, borough, and coordinates. The resolver rejects many overly broad fuzzy matches and placeholder BINs. Google-map clicks use reverse geocoding; City-map clicks also carry the selected footprint's BIN.
2. **Reuse a fresh snapshot.** A building cached less than 12 hours ago can be returned immediately. Otherwise, the API requests shed permits, HPD/DOB violations, 311 complaints, and the building footprint concurrently.
3. **Normalize and score the records.** The backend identifies fire/egress conditions, links permit renewals into a shed history, counts selected complaint types, and computes the four score components. Failed sources are listed in `data_gaps`.
4. **Build historical context.** The API normally requests grouped annual 311 counts. If Tiger Cloud is available, it imports the underlying complaint rows into TimescaleDB and queries annual buckets and a trend insight there.
5. **Return the building.** The UI flies to the address and displays the report while the briefing and news requests run.
6. **Generate the explanation.** Gemini is selected when configured, otherwise Grok. If the selected provider fails, a rules-based briefing is returned. News comes from Tavily and is filtered for an address match.
7. **Generate optional audio.** ElevenLabs TTS is tried first, then Grok TTS. The voice inspector is a separate interactive ElevenLabs WebRTC session supplied with the building report.

MongoDB stores `buildings` and `analyses`, with unique BIN indexes and a `2dsphere` index for nearby lookups. Building freshness is checked by application code; it is not a MongoDB TTL index. Analyses are valid only for the building's `fetched_at` snapshot. Rules-based fallback analyses are intentionally not persisted so a later request can retry the model.

Without MongoDB, reports are cached in process memory. Without Tiger Cloud, annual trends still work through NYC Open Data.

## Technology stack

| Area | Tools | Purpose |
| --- | --- | --- |
| Web UI | React 19, TypeScript 6 | Search, report state, controls, and interactive components |
| Frontend tooling | Vite 8, npm, Oxlint | Local server, API proxy, production bundle, and linting |
| Styling | Tailwind CSS 4, Archivo, IBM Plex Mono | Dark map interface, panels, and readable report typography |
| City renderer | Blocklight, MapLibre GL JS | NYC footprint extrusions and building datasets joined by BIN |
| 3D and overlays | deck.gl 9, loaders.gl 4 | Google 3D tile streaming, GeoJSON layers, shed polygons, and markers |
| API | Python 3.11+, FastAPI, Uvicorn | Asynchronous HTTP API and production static-file serving |
| Validation/config | Pydantic, pydantic-settings | Response schemas and environment-driven configuration |
| HTTP clients | HTTPX, browser Fetch API | Public-data and integration requests |
| Report cache | MongoDB Atlas, Motor | Persistent building/analysis snapshots and geospatial queries |
| Historical storage | Tiger Cloud, TimescaleDB, asyncpg | 311 row ingestion, hypertables, annual trend queries |
| Briefings | Google Gemini or xAI Grok | Short explanations grounded in retrieved records |
| Audio/voice | ElevenLabs TTS, ElevenLabs Agents, `@elevenlabs/react`, Grok TTS | Audio files and interactive voice sessions |
| News | Tavily | Address-specific search results |
| Messaging | Photon Spectrum, `spectrum-ts`, tsx | Optional iMessage and terminal agent |
| Packaging/deployment | uv, Docker, DigitalOcean App Platform, GitHub Actions | Locked dependencies, a production container, hosting, and verification |

Exact resolved dependency versions are recorded in `frontend/package-lock.json`, `photon-agent/package-lock.json`, and `backend/uv.lock`. The deployment container uses Node 22 to build the frontend and Python 3.13 for the API.

## Public data sources

The application queries [NYC GeoSearch](https://geosearch.planninglabs.nyc/) and the Socrata resource API at `https://data.cityofnewyork.us/resource`.

| Record / layer | Dataset | How it is used |
| --- | --- | --- |
| Addresses and identifiers | NYC GeoSearch v2 | Address autocomplete, BIN/BBL resolution, reverse geocoding |
| DOB NOW approved permits | [`rbx6-tga4`](https://data.cityofnewyork.us/d/rbx6-tga4) | Sidewalk-shed permits and the active-sheds layer |
| DOB BIS permit issuance | [`ipu4-2q9a`](https://data.cityofnewyork.us/d/ipu4-2q9a) | Legacy equipment/sidewalk-shed permit history |
| HPD Housing Maintenance Code violations | [`wvxf-dwi5`](https://data.cityofnewyork.us/d/wvxf-dwi5) | Open class B/C violations, including selected class C fire/egress conditions |
| DOB safety violations | [`855j-jady`](https://data.cityofnewyork.us/d/855j-jady) | Active building-system violations; selected energy/compliance paperwork is excluded |
| 311 service requests | [`erm2-nwe9`](https://data.cityofnewyork.us/d/erm2-nwe9) | Heat/hot-water, sewer-backup, and catch-basin complaints and annual trends |
| Building footprints | [`5zhs-2jue`](https://data.cityofnewyork.us/d/5zhs-2jue) | Geometry, roof height, ground elevation, construction year, and BBL-to-BIN joins |
| Street centerlines | [`inkn-q76z`](https://data.cityofnewyork.us/d/inkn-q76z) | City-map street geometry |
| Borough boundaries | [`gthc-hcne`](https://data.cityofnewyork.us/d/gthc-hcne) | City-map land geometry |
| Facade inspection records | [`xubg-57si`](https://data.cityofnewyork.us/d/xubg-57si) | Unsafe facades in cycle 10 and cycle 9 buildings not yet refiled in cycle 10 |
| HPD vacate orders | [`tb8q-a3ar`](https://data.cityofnewyork.us/d/tb8q-a3ar) | Open vacate orders, aggregated by BIN |
| Rat inspections | [`p937-wjvj`](https://data.cityofnewyork.us/d/p937-wjvj) | Failed rat-activity inspections in the last 365 days |
| Sandy inundation | [`5xsi-dfpx`](https://data.cityofnewyork.us/d/5xsi-dfpx) | Historical surge-extent overlay |
| Hurricane evacuation zones | [`epne-qv9x`](https://data.cityofnewyork.us/d/epne-qv9x) | Zone 1–3 overlays |

A shed is treated as active when its permit is unexpired and not signed off. Older permits whose coverage ends within 90 days of the next permit are treated as continuous coverage. This is a permit-based estimate of shed age, rather than a measurement of physical installation or removal.

Complaint matching uses BBL **or** normalized street address, because condo units may carry different tax-lot identifiers. For the citywide heat layer, complaints on a lot are assigned to that lot's tallest footprint.

## How scoring works

The score is computed in [`backend/app/services/scoring.py`](backend/app/services/scoring.py):

```text
hazard_score = min(100, S_fire + S_shed + S_env + S_repeat)
```

| Component | Points | Trigger |
| --- | ---: | --- |
| `S_fire` | 40 | At least one flagged fire/egress violation: selected HPD class C descriptions or DOB sprinkler, emergency-power, or photoluminescent-device violations |
| `S_shed` | 25 | An active sidewalk shed with estimated continuous coverage **greater than 730 days** |
| `S_env` | 15 | At least three selected heat/sewer/catch-basin complaints in the last 365 days |
| `S_repeat` | 20 | Retrieved open violations plus selected recent complaints total **more than five** |

**LOW:** 0–20 · **MODERATE:** 21–59 · **HIGH:** 60–100

For example, a building with a flagged fire condition, a shed older than 730 days, and more than five violations/complaints scores `40 + 25 + 20 = 85`. Three qualifying complaints would add the remaining 15 points.

Citywide rat, facade, vacate, and flood-area layers provide context. They do not independently add points to this formula. The “flood” complaint category specifically covers sewer-backup/catch-basin reports; it is not a modeled flood-risk assessment.

## Run locally

### Prerequisites

- Node.js 22.12+ and npm; Node 22.18+ is recommended for the test script's native TypeScript support.
- Python 3.11+ and [uv](https://docs.astral.sh/uv/).
- Internet access to GeoSearch and NYC Open Data.
- Optional provider accounts for maps, persistent storage, AI, voice, news, and messaging.

Clone the repository:

```bash
git clone https://github.com/7dracoder/BlindSpotNYC.git
cd BlindSpotNYC
```

### 1. Start the backend

```bash
cd backend
cp .env.example .env
# Edit .env to enable the integrations you want.
uv sync --locked
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

API health: <http://127.0.0.1:8000/api/health> · Interactive API docs: <http://127.0.0.1:8000/docs>

### 2. Start the frontend in another terminal

```bash
cd frontend
cp .env.example .env
# Add a Google Map Tiles key here to enable photorealistic imagery.
npm ci
npm run dev -- --host 127.0.0.1
```

Open <http://127.0.0.1:5173/>. Vite proxies `/api` to the backend on port 8000 and Google `/v1/3dtiles` requests to the tile service during development.

An empty frontend `.env` uses the City renderer. With no backend integration keys, address lookups and scoring still work, briefings use the rules-based explanation, and data is cached in memory.

### 3. Try the demo addresses

- `3605 Sedgwick Avenue, Bronx`
- `957 Woodycrest Avenue, Bronx`
- `76 Saint Nicholas Place, Manhattan`
- `225 West 86 Street, Manhattan`

These are real addresses, not fixture reports. Their scores and records can change. `/?q=3605%20Sedgwick%20Avenue%2C%20Bronx` opens a report directly.

### 4. Optional: pre-warm reports

```bash
cd backend
uv run python scripts/ingest.py
```

This fetches records, briefings, and audio for the four demo addresses. MongoDB must be configured if those snapshots should be available to a different API process. Model/TTS calls may consume provider credits.

## Environment variables

Local `.env` files contain credentials and are excluded from Git and Docker build contexts. Commit only the `.env.example` templates.

### Frontend: `frontend/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Empty | API origin; empty uses the same origin and Vite's development proxy |
| `VITE_GOOGLE_MAPS_API_KEY` | Empty | Browser-visible key for Google's **Map Tiles API**, including Photorealistic 3D Tiles |

Vite substitutes `VITE_*` values at **build time**. A change requires restarting the development server or rebuilding the production bundle. These values are readable by visitors; they must never contain backend API secrets. Restrict the Google key by API and allowed HTTP referrers.

### Backend: `backend/.env` or deployment runtime environment

| Variable | Default / fallback | Purpose |
| --- | --- | --- |
| `MONGODB_URI` | Empty → memory cache | MongoDB Atlas connection string |
| `MONGODB_DB` | `blindspot` | MongoDB database name |
| `TIGER_DATABASE_URL` | Empty → NYC Open Data trends | TimescaleDB connection string, normally with TLS enabled |
| `GEMINI_API_KEY` | Empty | Preferred briefing provider when configured |
| `GEMINI_MODEL` | `gemini-flash-latest` | Gemini model identifier |
| `XAI_API_KEY` | Empty | Grok briefing provider when Gemini is unset; also optional TTS fallback |
| `XAI_MODEL` | `grok-4.7` | Grok model identifier |
| `ELEVENLABS_API_KEY` | Empty | ElevenLabs TTS and voice-session tokens |
| `ELEVENLABS_VOICE_ID` | `JBFqnCBsd6RMkjVDRZzb` | TTS voice used by the project |
| `ELEVENLABS_AGENT_ID` | Empty | Existing ElevenLabs inspector agent |
| `TAVILY_API_KEY` | Empty → no news | Address-specific news search |
| `PUBLIC_APP_URL` | `http://127.0.0.1:5173` | Public report links in messaging responses |
| `PUBLIC_API_URL` | `http://127.0.0.1:8000` | Public API setting, reserved for integrations; current audio URLs are relative |
| `CORS_ORIGINS` | Localhost/127.0.0.1 on port 5173 | Comma-separated permitted cross-origin web clients |
| `AUDIO_DIR` | `data/audio` | Writable directory for generated MP3s |
| `FRONTEND_DIST` | Empty | Optional compiled frontend directory; set automatically by Docker |
| `PORT` | Docker default `8080` | Listening port used by the container startup command |

Use the model IDs supported by your provider account; defaults are configuration choices, not a guarantee of provider availability. If Gemini is set but fails, the current implementation returns the rules-based briefing rather than trying Grok afterward.

### Photon agent: `photon-agent/.env`

| Variable | Purpose |
| --- | --- |
| `SPECTRUM_PROJECT_ID` | Photon Spectrum project identifier |
| `SPECTRUM_PROJECT_SECRET` | Photon Spectrum project credential |
| `BLINDSPOT_API_URL` | Backend origin; defaults to `http://127.0.0.1:8000` |

## Google 3D map setup and troubleshooting

This project uses **Google Map Tiles API / Photorealistic 3D Tiles** through deck.gl. It does not use the Google Maps JavaScript API widget.

1. Enable Map Tiles API and billing in the Google Cloud project associated with your key.
2. Set `VITE_GOOGLE_MAPS_API_KEY` in `frontend/.env`.
3. Allow the development referrers you use, such as `http://127.0.0.1:5173/*` and `http://localhost:5173/*`, and the exact deployed HTTPS origin.
4. Restart Vite after changing the environment file. On DigitalOcean, set the key as a **build-time** variable and rebuild.
5. Use a browser with WebGL support and working hardware acceleration. High-detail 3D imagery uses substantial GPU memory and network bandwidth.

The tile-fetch adapter normalizes absolute/root-relative child URLs, preserves session query parameters, and attaches the key to tile requests. Development uses the Vite proxy; production fetches the Google tile origin directly. Visible copyright credits are extracted from loaded tiles and shown alongside Google Maps attribution.

| Symptom | Check |
| --- | --- |
| Only City view is available | The Google key was absent when the frontend started or was built |
| Google switches to City view | Read the map status message; check tile requests for authentication, quota, network, or WebGL failures |
| 401 / 403 tile response | Check the key, API enablement, billing, and allowed referrers |
| 429 tile response | Check provider quota and usage |
| Local API requests fail | Verify the backend on port 8000 and `/api/health` |
| Local tiles work but production fails | Verify the build-time key and production HTTP-referrer restrictions |
| Coarse imagery during a fly-to | Allow neighborhood tiles to stream in; switch to City view on slower devices |

The City renderer is a separate fallback using public building geometry. It is not an OpenStreetMap basemap. See [Google's renderer guidance](https://developers.google.com/maps/documentation/tile/create-renderer) and [deck.gl's 3D Tiles guide](https://deck.gl/docs/developer-guide/base-maps/using-with-3d-tiles).

## API reference

All application endpoints use `/api`. FastAPI publishes OpenAPI at `/openapi.json` and interactive documentation at `/docs`.

| Method | Endpoint | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Process health: `{"ok": true}` |
| GET | `/api/search?q=<text>` | Up to six address suggestions; minimum query length two |
| GET | `/api/lookup?q=<address>` | Resolve, retrieve/cache, and score a building |
| GET | `/api/lookup?lng=<lng>&lat=<lat>&bin=<bin>` | Resolve a City-map footprint; omit `bin` for a Google-map click |
| GET | `/api/analyze/{bin_id}` | Cached or newly generated briefing and news for a previously looked-up building |
| POST | `/api/analyze/{bin_id}/audio` | Generate audio if available and return the analysis with `audio_url`/`audio_engine` |
| GET | `/api/audio/{filename}` | Serve a generated MP3 |
| GET | `/api/voice/{bin_id}/session` | Short-lived ElevenLabs token and dynamic building-report variables |
| GET | `/api/nearby?lng=<lng>&lat=<lat>&meters=1500` | Up to 50 previously scanned nearby buildings; radius capped at 5000 m |
| POST | `/api/sms/lookup` | JSON `{"text":"<address>"}` → reply text and report URL |
| GET | `/api/map/buildings/manifest.json` | City footprint tile manifest, zoom 15 |
| GET | `/api/map/buildings/{x}/{y}.json` | GeoJSON footprint tile |
| GET | `/api/map/streets/{x}/{y}.json` | GeoJSON street tile |
| GET | `/api/map/land.json` | Borough land geometry |
| GET | `/api/map/layers/{layer_id}.json` | Building records or area GeoJSON for one supported layer |

Supported layer IDs: `unsafe-facades`, `active-sheds`, `vacate-orders`, `rat-activity`, `heat-complaints`, `sandy-2012`, and `evacuation-zones`.

Example requests:

```bash
curl 'http://127.0.0.1:8000/api/search?q=3605%20Sedgwick'
curl 'http://127.0.0.1:8000/api/lookup?q=3605%20Sedgwick%20Avenue%2C%20Bronx'
curl -X POST 'http://127.0.0.1:8000/api/sms/lookup' \
  -H 'Content-Type: application/json' \
  -d '{"text":"3605 Sedgwick Avenue, Bronx"}'
```

A building response includes identity and geometry, `shed`, permit/violation/complaint records, aggregate counts, annual trends, `hazard_score`, `risk_label`, `score_breakdown`, `data_gaps`, and `fetched_at`. An analysis response includes the briefing provider, matching news, and optional audio URL/provider.

An unmatched address returns 404; upstream geocoding failures return 502; unconfigured voice returns 503. Individual building-source failures can yield a partial report with `data_gaps` instead of failing the entire lookup.

## Optional integrations

### ElevenLabs voice inspector

Configure `ELEVENLABS_API_KEY` and an existing `ELEVENLABS_AGENT_ID`. To create the project's sample inspector agent:

```bash
cd backend
uv run python scripts/create_voice_agent.py
```

This creates an agent in the configured ElevenLabs account and prints its ID. Save that ID in the backend environment. The API obtains a short-lived conversation token and supplies the address, risk label, and retrieved building report to the frontend. Interactive speech requires HTTPS in production and microphone permission; localhost is suitable for development.

### Tiger Cloud / TimescaleDB

Set `TIGER_DATABASE_URL` to a PostgreSQL service with TimescaleDB support. The connection must allow creation of the `complaints_311` table, hypertable, and index. The startup code creates them if absent. Each lookup can ingest up to 50,000 matching historical rows; `(unique_key, created_at)` prevents duplicate inserts. Annual counts use `time_bucket('1 year', created_at)`.

### Photon iMessage agent

```bash
cd photon-agent
cp .env.example .env
# Configure your Spectrum project and BLINDSPOT_API_URL.
npm ci
npm start
```

The agent listens through Spectrum's iMessage and terminal providers. Messages containing an address are forwarded to `/api/sms/lookup`. Greetings or messages without digits return usage help. This is a separate long-running process and is not included in the web container or default DigitalOcean spec. Do not send a real message during testing unless you intend to contact that recipient.

## Deploy to DigitalOcean

The root [Dockerfile](Dockerfile) builds the React frontend and runs FastAPI as a non-root user. FastAPI serves the compiled UI, `/api`, and MP3s from one origin on port 8080. There is no production dependency on Vite's development proxy.

The [.do/app.yaml](.do/app.yaml) template defines one App Platform web service in the NYC region with a 1 GB shared instance and a `/api/health` health check. It uses the public Git repository, so no new GitHub account permissions are required to fetch the source. The template contains no credentials and leaves Google imagery disabled until its build variable is configured.

### App Platform steps

1. Activate your DigitalOcean account and payment method. Review the selected instance's current monthly price before creating the app.
2. Create an App Platform app from this repository or import `.do/app.yaml` as the app specification. Select `main`, the repository root, and the root `Dockerfile`.
3. Keep the HTTP port at `8080` and health-check path at `/api/health`.
4. Set `VITE_GOOGLE_MAPS_API_KEY` as a **BUILD_TIME** variable if Google imagery is wanted. The Dockerfile declares a matching build argument. This key remains browser-visible even if DigitalOcean labels the variable a secret.
5. Add desired backend credentials as **RUN_TIME secret** variables: `MONGODB_URI`, `TIGER_DATABASE_URL`, `GEMINI_API_KEY`/`XAI_API_KEY`, `ELEVENLABS_API_KEY`, and `TAVILY_API_KEY`. Add `ELEVENLABS_AGENT_ID` and any provider model/voice overrides as needed. Do not paste local `.env` files into GitHub.
6. Keep `PUBLIC_APP_URL`, `PUBLIC_API_URL`, and `CORS_ORIGINS` pointed at the assigned app URL. The supplied spec uses DigitalOcean's `${APP_URL}` binding for these values.
7. Ensure Atlas/Tiger permit the deployment's connection and egress network. Prefer provider-supported restricted access rather than exposing a database broadly.
8. Deploy, then verify `/api/health`, the homepage, an address lookup, both map sources, and audio. Add the app's HTTPS origin to the Google key's allowed referrers and rebuild if required.

With an already-authenticated DigitalOcean CLI, the same spec can be used with:

```bash
doctl apps create --spec .do/app.yaml
```

The public Git source in the template does not enable automatic deployment on every push. Trigger subsequent deployments in App Platform, or configure the GitHub integration and `deploy_on_push` if you want that behavior.

### Run the production container locally

With Docker installed:

```bash
docker build -t blindspot-nyc .
docker run --rm -p 8080:8080 \
  --env-file backend/.env \
  -e FRONTEND_DIST=/app/frontend/dist \
  -e AUDIO_DIR=/app/backend/data/audio \
  -e PUBLIC_APP_URL=http://127.0.0.1:8080 \
  -e CORS_ORIGINS=http://127.0.0.1:8080 \
  blindspot-nyc
```

This builds the City-only UI. To enable Google, supply `--build-arg VITE_GOOGLE_MAPS_API_KEY=...` through your deployment's private build configuration. Never put real keys into checked-in files. Open <http://127.0.0.1:8080/>.

For a production-style run without Docker, build the frontend and serve it from FastAPI:

```bash
cd frontend
npm run build
cd ../backend
FRONTEND_DIST=../frontend/dist uv run uvicorn app.main:app --host 127.0.0.1 --port 8080
```

### Persistence

App Platform's container filesystem is ephemeral. Generated MP3s may disappear after a restart or deployment. The API detects stale cached audio links and regenerates files on the next audio request, provided TTS remains configured. For durable audio or multiple replicas, move audio to object storage and update the synthesis/storage code.

MongoDB Atlas and Tiger Cloud persist independently of the container. With the in-memory fallback, reports and nearby-building history disappear when the process restarts. Keep the default single API process if relying on that fallback.

## Repository layout

```text
.
├── README.md
├── Dockerfile                    # Build UI, run API + static UI on port 8080
├── .dockerignore                 # Keep credentials/generated data out of builds
├── .do/app.yaml                  # DigitalOcean App Platform template
├── .github/workflows/ci.yml      # Frontend, backend, and agent verification
├── backend/
│   ├── app/
│   │   ├── main.py               # Lifespan, middleware, routes, static files
│   │   ├── config.py             # Environment settings
│   │   ├── db.py                 # Atlas connection and indexes
│   │   ├── models/building.py    # API schemas
│   │   ├── routers/api.py        # Lookup, analysis, audio, voice, map, messaging
│   │   └── services/
│   │       ├── nyc_data.py       # Address resolution and normalized city records
│   │       ├── scoring.py        # Risk rules and explanations
│   │       ├── store.py          # Snapshot cache and nearby reports
│   │       ├── city_tiles.py     # Cached footprint/street/land geometry
│   │       ├── map_layers.py     # Context layers
│   │       ├── tiger.py          # TimescaleDB history and trends
│   │       ├── llm.py            # Briefing providers and rules fallback
│   │       ├── news.py           # Tavily and address filtering
│   │       ├── tts.py            # Audio synthesis and MP3 files
│   │       └── voice.py          # Inspector report and conversation tokens
│   ├── scripts/                  # Demo ingest and sample voice-agent creation
│   ├── tests/                    # Deployment/audio regression check
│   ├── pyproject.toml
│   └── uv.lock
├── frontend/
│   ├── src/
│   │   ├── App.tsx              # Search/report orchestration and map controls
│   │   ├── components/          # Maps, report panels, voice, and search UI
│   │   ├── api/client.ts        # Typed API client and audio URL resolution
│   │   ├── data/                # Map layer definitions and demo addresses
│   │   ├── lib/                 # Tile fetches, X-ray placement, map rotation
│   │   └── types.ts             # Frontend response types
│   ├── tests/                   # Tile URL/authentication regression checks
│   ├── vite.config.ts
│   └── package-lock.json
└── photon-agent/
    ├── src/index.ts             # Spectrum address-message handler
    ├── .env.example
    └── package-lock.json
```

## Verification and development

```bash
# Frontend typecheck, production build, lint, and tile-request tests
cd frontend
npm ci
npm run build
npm run lint
npm test

# Backend syntax and cached-audio regression check
cd ../backend
uv sync --locked
uv run python -m compileall -q app scripts
uv run python -m unittest discover -s tests

# Optional messaging agent typecheck, without sending messages
cd ../photon-agent
npm ci
npx tsc --noEmit
```

GitHub Actions runs these checks and builds the Docker image on pushes to `main` and pull requests. Provider-backed functionality also needs a live smoke test with the appropriate credentials. The health endpoint confirms API availability; it does not certify that every external provider is reachable.

## Data limits and operational considerations

- **Freshness:** Building snapshots are reused for 12 hours. Map context layers also use a 12-hour process cache; HTTP cache headers vary by route. Lookups are not necessarily fresh requests to every source.
- **Partial records:** Upstream errors are recorded in `data_gaps`. The score may understate conditions when a source is missing. Review the gaps and the original city records.
- **Query limits:** A building lookup retrieves up to 150 HPD and 50 DOB violation rows, 200 permits per shed source, and the 100 most recent complaint records. Recent complaint totals come from aggregate queries, so displayed markers and lists need not equal the totals. Historical and citywide queries have row limits and are not fully paginated.
- **Approximate markers:** X-ray dots are deterministic visual placements inside a footprint. HPD story values inform fire-marker height when present; other heights/positions are illustrative. At most 60 markers per kind are shown. They are not measured incident coordinates or an interior floor plan.
- **Geometry fallback:** If no footprint is available, the report uses a small rectangle around the resolved coordinate. Footprint heights are converted from feet to meters.
- **Interpretation:** Complaint counts represent reports, not unique confirmed incidents. The current year is incomplete, and the Tiger insight compares its count to historical annual counts without seasonality adjustment.
- **News matching:** The filter checks the house number and first street token and can still produce imperfect matches. Open linked sources to verify them.
- **AI:** Briefings and voice responses are generated from a limited report. Inspect the underlying violations and data gaps for decisions requiring greater certainty.
- **Provider costs:** Briefing, TTS, voice, news, map, and hosting services can incur usage charges. Audio is requested automatically after analysis in the current web flow.
- **Public API:** The prototype has no end-user authentication or application-level rate limiting. Before a broad public launch, protect provider-backed endpoints and set usage limits; CORS alone does not control API access.
- **Performance:** The 3D mapping dependencies produce a large frontend bundle, and citywide geometry can take time to warm up. City view remains available when Google cannot load.

Public-data attribution belongs to NYC's publishing agencies; Google imagery and other provider services remain subject to their own terms. No project license has been declared in this repository.
