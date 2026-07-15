# CU-Connect — Backend (Production Build)

Express + **MongoDB (Mongoose)** + JWT + Socket.IO. This is the production
migration described in `../CU-Connect_Production_Assessment.pdf`: the old
local-file SQLite store has been replaced with MongoDB so the app can run on a
real host (data no longer vanishes on restart / across instances).

## Stack

| Piece            | Tech                                             |
|------------------|--------------------------------------------------|
| Web framework    | Express 4                                        |
| Auth             | JWT (jsonwebtoken) + bcryptjs                     |
| Database         | MongoDB via Mongoose (`models/`)                  |
| Real-time        | Socket.IO (`lib/realtime.js`)                     |
| Academics logic  | Bunk calc + SGPA/CGPA (`lib/academics.js`)        |
| Code IDE         | Feature-flagged, **off in production** (unsandboxed) |

## Collections (was 6 SQLite tables)

`users → User`, `subjects → Subject`, `attendance → Attendance`,
`grades → Grade`, `leaves + leave_audit → Leave` (audit trail is an embedded
append-only array), `announcements → Announcement`. See `models/`.

## Run it locally

```bash
cd "CU - Connect/Backend"
cp .env.example .env          # then set MONGODB_URI (local Mongo or Atlas)
npm install
npm start                     # http://localhost:4000, seeds the DB on first boot
```

You need a MongoDB to point at:
- **Local:** install MongoDB and use `mongodb://127.0.0.1:27017/cu-connect`.
- **Atlas (free M0):** create a cluster, add a DB user + network access, and use
  the `mongodb+srv://…` connection string.

Open **http://localhost:4000/login.html** (the backend serves the frontend in
dev). Re-seed from scratch by dropping the database and restarting.

## Environment variables

See `.env.example`. In production these are set in the host dashboard:

| Var            | Purpose                                                        |
|----------------|----------------------------------------------------------------|
| `NODE_ENV`     | `production` on the host                                       |
| `PORT`         | injected by the host                                          |
| `JWT_SECRET`   | **required in prod** — server refuses to boot on the dev default |
| `MONGODB_URI`  | MongoDB Atlas connection string                               |
| `CORS_ORIGINS` | comma-separated Vercel frontend origin(s)                     |
| `IDE_ENABLED`  | keep `false` in prod until a sandbox (Judge0) is wired         |

## Demo accounts (password for all: `password123`)

| Name       | Login (email or roll)                       | Profile                   |
|------------|---------------------------------------------|---------------------------|
| Pallakshi  | `pallakshi@chitkara.edu.in` / `2210991045`  | CGPA ~8.3 — "Good"        |
| Aarav      | `aarav@chitkara.edu.in` / `2210990001`      | CGPA ~9.6 — "Excellent ✦" |
| Isha       | `isha@chitkara.edu.in` / `2210990002`       | CGPA ~8.6 — "Good"        |
| Rajesh (T) | `rajesh@chitkara.edu.in` / `FAC-CSE-014`    | Teacher                   |

## Deployment (recommended split — keeps every feature working)

- **Frontend** (`Frontend/Landing Page`, static) → **Vercel** (`vercel.json`).
- **Backend** (this dir, Express + Socket.IO) → **Render** (`render.yaml`).
- **Database** → **MongoDB Atlas** (free M0).
- **Code IDE** → disabled in production (`IDE_ENABLED=false`); wire to a hosted
  Judge0/Docker sandbox before enabling. The bundled `lib/runner.js` is
  unsandboxed and must never face the internet.

Steps:
1. Create a MongoDB Atlas M0 cluster; copy the connection string.
2. Deploy this backend on Render via the blueprint (`render.yaml`); set
   `MONGODB_URI` and `CORS_ORIGINS` (your Vercel URL) in the dashboard.
3. Deploy the frontend on Vercel; in `Frontend/Landing Page/config.js` set
   `API_BASE` and `SOCKET_URL` to your Render backend URL.

Why not "everything on Vercel": serverless functions are short-lived and
stateless, which breaks Socket.IO (needs a long-lived connection) and the code
runner (no toolchain, read-only FS). The persistent Node host (Render) keeps
both working.

## API

| Method | Route                          | Auth   | Purpose                          |
|--------|--------------------------------|--------|----------------------------------|
| POST   | `/api/auth/login`              | —      | `{ identifier, password }` (rate-limited) |
| POST   | `/api/auth/signup`             | —      | create a student account (rate-limited)   |
| GET    | `/api/auth/me`                 | JWT    | current user                     |
| PUT    | `/api/auth/me`                 | JWT    | update profile                   |
| PUT    | `/api/auth/password`           | JWT    | change password                 |
| GET    | `/api/dashboard`               | JWT    | headline dashboard numbers       |
| GET    | `/api/attendance`              | JWT    | attendance + bunk calculator     |
| GET    | `/api/results`                 | JWT    | SGPA/CGPA + grades               |
| GET    | `/api/announcements`           | JWT    | student notifications feed       |
| GET/POST | `/api/leaves…`               | JWT    | leave requests + audit trail     |
| *      | `/api/teacher/*`               | Teacher/Admin | roster, marking, grading, leave decisions, announcements |
| POST   | `/api/execute`                 | JWT    | IDE runner (only when `IDE_ENABLED`) |
| GET    | `/healthz`                     | —      | health check                     |
