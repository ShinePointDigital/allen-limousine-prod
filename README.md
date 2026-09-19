# Allan Limousine

A portable full-stack website and operations dashboard for a private Chicago chauffeur service.

## Stack

- React, Vite, and TypeScript
- Node.js and Express
- PostgreSQL with Prisma ORM
- Zod validation and bcrypt password hashing
- Secure, HTTP-only cookie sessions
- Twilio driver dispatch through the server-side Replit connector

Prisma uses PostgreSQL's application-side connection pool. The example and Docker connection strings set `connection_limit=10` and `pool_timeout=10`; tune those values to the hosting provider's connection budget rather than opening an unbounded pool.

## Local development

Requirements: Node.js 22+ and PostgreSQL 15+.

1. Copy `.env.example` to `.env` and replace every placeholder.
2. Create the PostgreSQL database named in `DATABASE_URL`.
3. Install dependencies with `npm ci`.
4. Generate the Prisma client with `npm run db:generate`.
5. Apply the schema with `npm run db:migrate`.
6. Seed an initial administrator with `npm run db:seed`, or create one interactively with `npm run admin:create`.
7. Start development with `npm run dev`.

The app listens on `0.0.0.0` and uses `PORT` (default `5000`). Express and Vite share the same origin, so no API URL configuration is required.

## Admin access

Open `/admin/login`. In a configured production environment, administrators are stored in PostgreSQL with bcrypt password hashes. Confirming an inquiry creates a dispatch-ready ride. The operations workspace tracks vehicle and chauffeur assignments, ride status, quoted fares, deposits, collections, expenses, outstanding balances, estimated profit, and unread booking alerts.

### Driver dispatch SMS

Connect Twilio to the Replit project and set `TWILIO_FROM_NUMBER` to an SMS-capable Twilio number in E.164 format, such as `+13125550188`. `TWILIO_ACCOUNT_SID` is optional; the server discovers the connected account when it is omitted. Provider credentials remain in the connector and are never sent to the browser.

In **Rides & dispatch**, assign an active fleet vehicle, chauffeur name, and driver mobile number. The review box is populated from the linked booking with customer, pickup time, origin, destination, service, passenger count, and dispatch notes. Sending records both successful and failed provider attempts in the ride’s recent activity. A Twilio trial account can send only to verified destination numbers.

For a private local visual preview without a database, the app has an in-memory demo adapter. It is disabled by default: set `ALLOW_IN_MEMORY_DEMO=true`, `ADMIN_EMAIL`, and `ADMIN_BOOTSTRAP_PASSWORD` explicitly to enable it. Never expose demo mode to the public internet. Inquiries created in fallback mode reset when the server restarts. Production mode refuses to start without `DATABASE_URL` and a `SESSION_SECRET` of at least 32 characters; the fallback administrator is never used in production.

## Production build

```sh
npm ci
npm run db:generate
npm run build
NODE_ENV=production npm start
```

Run database migrations during release:

```sh
npx prisma migrate deploy
```

Use a long random `SESSION_SECRET`, terminate TLS at your hosting proxy, and never commit `.env`.

## Docker deployment

Create a `.env` file containing at least:

```text
POSTGRES_PASSWORD=a-long-random-database-password
SESSION_SECRET=a-long-random-session-secret
TWILIO_FROM_NUMBER=+13125550188
```

Then run:

```sh
docker compose up --build -d
docker compose exec app npm run admin:create
```

The app container applies pending Prisma migrations before starting the web server, so a fresh database is ready on first boot. Compose waits for PostgreSQL's health check, uses a named database volume, and exposes `${PORT:-5000}`.

## Database backup and restore

Create a compressed backup:

```sh
docker compose exec -T database pg_dump -U allan -d allan_limousine -Fc > allan-limousine.dump
```

Restore into an empty database:

```sh
docker compose exec -T database pg_restore -U allan -d allan_limousine --clean --if-exists < allan-limousine.dump
```

For externally hosted PostgreSQL, run the equivalent `pg_dump` and `pg_restore` commands against the provider's connection details.

## Image storage

Public content currently uses HTTPS-hosted editorial imagery. `server/storage.ts` defines the image storage boundary so a customer can later substitute S3, Cloudflare R2, or another object store without changing content models.

Remote Unsplash paths use `auto=format`, crop sizing, and quality parameters. Rendered below-the-fold images use native lazy loading and asynchronous decoding; the hero remains eager as the above-the-fold visual.

## Key routes

- `/` — public website and reservation form
- `/admin/login` — administrator sign-in
- `/admin` — dashboard overview
- `/admin/rides` — ride schedule, dispatch assignments, and ride financials
- `/admin/inquiries` — inquiry pipeline and CSV export
- `/admin/services`, `/admin/fleet`, `/admin/content` — content management

## Validation

Run `npm run typecheck` and `npm run build` before deployment.