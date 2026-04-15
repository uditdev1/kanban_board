# Kanban Board — Real-Time Collaborative Task Manager

A real-time collaborative Kanban board with drag-and-drop, multi-user presence, conflict resolution, and offline support.

## Live Demo

| | URL |
|---|---|
| **Client** | [https://shop-us-assignment.vercel.app](https://shop-us-assignment.vercel.app) |
| **Health Check** | [/api/health](https://shopus-api.onrender.com/api/health) |

> Frontend is deployed on **Vercel**, backend on **render**.
## Features

- **Three-column Kanban board**: To Do, In Progress, Done
- **Real-time sync**: All changes propagate to connected clients via WebSockets (< 200ms on localhost)
- **Drag-and-drop**: Move and reorder tasks between/within columns using @dnd-kit
- **Conflict resolution**: Version-based optimistic concurrency control with user notifications
- **Optimistic UI**: Instant response to user actions, reconciled with server state
- **Multi-user presence**: See who's online with colored avatars
- **Offline support**: Queue actions while disconnected, replay on reconnect
- **Fractional indexing**: O(1) amortized task ordering — no array re-indexing

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Bun |
| Backend | Express + TypeScript |
| WebSocket | Socket.IO |
| Database | PostgreSQL + Prisma |
| Frontend | React 18 + TypeScript + Vite |
| Drag & Drop | @dnd-kit |
| State | useContext |

## Quick Start

### Prerequisites

- [Docker](https://www.docker.com/) and Docker Compose
- [Node.js 18+](https://nodejs.org/) or [Bun](https://bun.sh/)

### Option 1: Docker Compose (Recommended)

```bash
# Start PostgreSQL + API
docker compose up -d

# Start frontend dev server
cd client
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### Option 2: Manual Setup

```bash
# 1. Start PostgreSQL (your own instance)
# Update api/.env with your DATABASE_URL

# 2. Start API
cd api
bun install
bunx prisma migrate deploy
bun run dev

# 3. Start Client (in another terminal)
cd client
npm install
npm run dev
```

## Project Structure

```
├── api/                        # Backend (Bun + Express + Socket.IO)
│   ├── src/
│   │   ├── index.ts            # Server entry point
│   │   ├── config/             # Environment config
│   │   ├── handlers/           # WebSocket event handlers
│   │   ├── routes/             # REST API routes
│   │   ├── services/           # Business logic (conflict resolution)
│   │   ├── types/              # TypeScript types + Zod schemas
│   │   └── utils/              # Fractional indexing utility
│   ├── prisma/                 # Database schema + migrations
│   ├── tests/                  # Integration + unit tests
│   └── Dockerfile
│
├── client/                     # Frontend (React 18 + Vite)
│   ├── src/
│   │   ├── App.tsx             
│   │   ├── main.tsx            
│   │   ├── index.css           # Global styles
│   │   ├── screens/
│   │   │   └── Home/
│   │   │       ├── Home.tsx    # Home screen
│   │   │       ├── useHome.tsx 
│   │   │       ├── context.ts  
│   │   │       └── components/
│   │   │           ├── Board.tsx            # Drag-and-drop board
│   │   │           ├── Column.tsx           # Kanban column
│   │   │           ├── TaskCard.tsx         # Task card UI
│   │   │           ├── TaskForm.tsx         # Create/edit form
│   │   │           ├── ConflictResolver.tsx # Conflict resolution modal
│   │   │           ├── ConnectionStatus.tsx # Online/offline indicator
│   │   │           ├── PresenceBar.tsx      # Active users display
│   │   │           └── ErrorBoundary.tsx    # Error boundary
│   │   ├── hooks/              # useOfflineQueue
│   │   ├── services/           # Socket.IO client
│   │   ├── types/              # Shared TypeScript types
│   │   └── utils/              # Fractional indexing utility
│   └── index.html
│
├── .github/workflows/          # CI/CD (Docker Hub + Render deploy)
├── docker-compose.yml
├── DESIGN.md                   # Conflict resolution & architecture docs
└── README.md
```

## Environment Variables

### API (`api/.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/kanban
CLIENT_URL=http://localhost:5173
PORT=3001
```

### Client (`client/.env`)

```env
VITE_API_URL=http://localhost:3001
```

For production, set `VITE_API_URL` to your deployed backend URL.

## Deployment

### Frontend — Vercel

1. Connect your GitHub repo to Vercel
2. Set root directory to `client`
3. Set environment variable: `VITE_API_URL=https://abc-api.com`
4. Deploy

### Backend — Render (Docker)

1. Create a new Web Service on Render
2. Connect your GitHub repo
3. Set root directory to `api`
4. Select "Docker" as the environment
5. Add environment variables:
   - `DATABASE_URL` — Your Render PostgreSQL connection string
   - `CLIENT_URL` — `https://vercel-url.vercel.app`
   - `PORT` — `3001`
6. Deploy

### Database — Render PostgreSQL

1. Create a new PostgreSQL instance on Render
2. Copy the Internal Database URL
3. Use it as `DATABASE_URL` for the API

> **Cold Start**: Render's free tier spins down after 15 min of inactivity. Expected cold start time: ~30-60 seconds.

## Design Decisions

See [DESIGN.md](./DESIGN.md) for detailed documentation on:
- Conflict resolution strategy (version-based OCC)
- Task ordering approach (fractional indexing)
- Architecture trade-offs

## Testing

```bash
cd api
bun test
```

Tests cover:
- **Integration**: Concurrent move+edit, move+move, concurrent reorder scenarios
- **Unit**: Fractional indexing position generation and ordering consistency
