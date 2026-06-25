# Datanaut

A full-stack data visualization platform for connecting to live and static data sources, building interactive 2D/3D dashboards, and presenting them in real time. Datanaut pairs a React + Vite frontend with a multi-source Node.js API gateway and a Python presentation service, supporting both ad-hoc file uploads and persistent database/stream connections.

---

## Architecture

```
┌──────────────────────────────┐        ┌─────────────────────────────────┐
│  Frontend (React + Vite)     │  HTTP  │  API Gateway (Express, Node.js) │
│  - Pages, routing, providers │ <────> │  - REST routes + WebSocket feed │
│  - Recharts 2D / 3D charts   │   WS   │  - Connection manager           │
│  - Firebase auth             │        │  - Source modules (below)       │
└──────────────────────────────┘        └───────────────┬─────────────────┘
                                                         │
        ┌────────────────────────────────────────────────┼───────────────────────┐
        │            │           │          │         │          │                │
     MySQL /      MongoDB      MQTT       Serial     HTTP    ThingSpeak        SQLite
     Postgres    (Mongoose)   broker      port     polling     feed         (static DB)
                                                         │
                                              ┌──────────┴──────────┐
                                              │ Presentation Manager │
                                              │   (Python service)   │
                                              └──────────────────────┘
```

## Tech Stack

| Layer        | Technologies |
|--------------|--------------|
| Frontend     | React 18, Vite 7, React Router 6, Recharts, Tailwind CSS, Lucide icons |
| Auth         | Firebase Authentication + Firestore |
| API Gateway  | Node.js, Express, WebSocket (`ws`), Multer uploads, rate limiting |
| Data sources | MySQL / PostgreSQL, MongoDB (Mongoose), SQLite, MQTT, Serial, HTTP, ThingSpeak, Google Sheets |
| Presentation | Python presentation manager service |
| Tooling      | Concurrently, Nodemon, Node test runner + Supertest |

## Features

- **Multi-source connectivity** — relational (MySQL/Postgres/SQLite), NoSQL (MongoDB), streaming (MQTT, serial, HTTP, ThingSpeak), and file/sheet imports.
- **Static & dynamic data** — upload CSV/XLSX/JSON for one-off analysis, or register persistent connections for live querying with server-side pagination and search.
- **2D & 3D visualization** — line, bar, area, scatter, pie, donut, radar, and 3D chart types with live preview.
- **Real-time dashboards** — WebSocket-driven charts that update as new data arrives.
- **Presentation mode** — dedicated presentation window and a Python-backed presentation manager for full-screen, multi-display output.
- **Authentication** — Firebase-backed login with guarded routes.

## Project Structure

```
.
├── public/samples/            # Seed sample datasets
├── dataconnect/               # Firebase Data Connect schema
├── docs/                      # Technical reference documentation
├── src/
│   ├── App.jsx                # Routes + layout shell
│   ├── main.jsx               # App bootstrap
│   ├── firebase.js            # Firebase config (env-driven)
│   ├── pages/                 # Login, Data, Visualize, Dashboard (static + dynamic)
│   ├── providers/             # Auth, Store, Theme, WebSocket contexts
│   ├── ui/                    # Chart renderers, presentation, chatbot, tables
│   ├── utils/                 # Data parsing + chart helpers + API clients
│   ├── styles/                # Tailwind + liquid-glass styles
│   └── backend/
│       ├── server.js          # Express + WebSocket entry point
│       ├── routes.js          # REST API surface
│       ├── connectionManager.js
│       ├── chartsStorage.js
│       ├── modules/           # sql, nosql, mqtt, serial, http, thingSpeak, staticDb
│       ├── middleware/        # API key auth
│       ├── presentation_manager.py
│       └── test/              # Integration test suite
└── tailwind.config.js
```

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.10+ (for the presentation manager)
- A Firebase project (for authentication)

### 1. Install dependencies
```bash
npm run install:all   # installs frontend + backend dependencies
```

### 2. Configure environment
Copy the templates and fill in your own values:
```bash
cp .env.example .env
cp src/backend/.env.example src/backend/.env
```

Frontend (`.env`):
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_OPENAI_KEY=                 # optional, for chat features
VITE_GOOGLE_SHEETS_API_KEY=      # optional
```

Backend (`src/backend/.env`):
```
API_SECRET=        # blank disables API auth (dev only)
ENCRYPTION_KEY=
PORT=8085
CORS_ORIGIN=
```

> **Never commit real credentials.** `.env` files and `connections.json` are gitignored.

### 3. Run in development
```bash
npm start            # runs Vite frontend + Express backend concurrently
```
- Frontend: `http://localhost:5173`
- Backend API / WebSocket: `http://localhost:8085`

Run services individually if preferred:
```bash
npm run dev          # frontend only
npm run dev:backend  # backend only
```

## Testing
```bash
cd src/backend
npm test             # Node test runner + Supertest integration suite
```

## Building for Production
```bash
npm run build
npm run preview
```

## Documentation
Detailed technical references live in [`docs/`](docs/):
- [`API.md`](docs/API.md) / [`API_ROUTES_REFERENCE.md`](docs/API_ROUTES_REFERENCE.md) — REST API surface
- [`BACKEND.md`](docs/BACKEND.md) / [`BACKEND_ARCHITECTURE.md`](docs/BACKEND_ARCHITECTURE.md) — server internals
- [`FRONTEND.md`](docs/FRONTEND.md) — frontend architecture
- [`WINDOWS_PRESENTATION_LOGIC.md`](docs/WINDOWS_PRESENTATION_LOGIC.md) — presentation mode
- [`PLATFORM_COMPARISON.md`](docs/PLATFORM_COMPARISON.md) / [`QUICK_REFERENCE.md`](docs/QUICK_REFERENCE.md)

## License

Proprietary — all rights reserved.
