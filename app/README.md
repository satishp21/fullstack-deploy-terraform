# Sample MERN app

A small task list that exercises the full stack: React → CloudFront → Express → MongoDB. Replace it with your own app; see [docs/DEPLOY_YOUR_OWN_APP.md](../docs/DEPLOY_YOUR_OWN_APP.md).

```text
app/
├── backend/                 Express 5 + Mongoose 9 (Node 24)
│   ├── src/
│   │   ├── server.js        connect to MongoDB (with retries), start HTTP server, graceful shutdown
│   │   ├── app.js           middleware (helmet, JSON body, request logging), routes, error handling
│   │   ├── config.js        env vars: PORT, MONGODB_URI, APP_VERSION, TRUST_PROXY_HOPS, LOG_LEVEL
│   │   ├── db.js            Mongoose connection helpers
│   │   ├── logger.js        JSON logger (one line per event, CloudWatch-friendly)
│   │   ├── models/task.model.js
│   │   ├── routes/health.routes.js   GET /api/health  (200 ok / 503 when the DB is down)
│   │   ├── routes/task.routes.js     /api/tasks CRUD
│   │   └── middleware/error-handler.js
│   ├── Dockerfile           multi-stage, production deps only, runs as non-root "node" user
│   └── .env.example
├── frontend/                React 19 + Vite 8
│   ├── src/App.jsx          task list UI + API status badge
│   ├── src/api.js           fetch wrapper; relative /api URLs
│   └── vite.config.js       dev proxy /api -> http://localhost:8080
└── docker-compose.yml       local development: MongoDB + API
```

## API

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/health` | - | `{ status, database, version, environment, uptimeSeconds, timestamp }` |
| GET | `/api/tasks` | - | `[{ id, title, completed, createdAt, updatedAt }]` (newest first, max 500) |
| POST | `/api/tasks` | `{ "title": "Buy milk" }` | `201` + task |
| PATCH | `/api/tasks/:id` | `{ "title"?: string, "completed"?: boolean }` | updated task |
| DELETE | `/api/tasks/:id` | - | `204` |

## Run locally

Option A, everything in Docker except the React dev server:

```bash
cd app
docker compose up --build                 # MongoDB on :27017, API on http://localhost:8080
npm install --prefix frontend
npm run dev --prefix frontend             # http://localhost:5173
```

Option B, Node directly (needs a MongoDB on localhost:27017, e.g. `docker compose up mongo`):

```bash
cd app/backend
copy .env.example .env                    # cp on macOS/Linux
npm install
npm run dev                               # node --watch, reloads on changes
```

## How it runs in AWS

- The frontend build (`frontend/dist`) is uploaded to S3 and served by CloudFront.
- The backend image is built from `backend/Dockerfile`, pushed to ECR and started on the EC2 server with `PORT=8080`, `NODE_ENV=production`, `APP_VERSION=<image tag>` and `MONGODB_URI` from SSM Parameter Store.
- `trust proxy` is 2 in production (CloudFront + nginx), so `req.ip` is the real client IP.
