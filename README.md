# BloodLink – Emergency Blood Donor Finder

BloodLink is a community coordination application for discovering voluntary blood donors and sharing blood requests. It is not a blood bank, healthcare provider, or transfusion matching system.

## Problem and objectives

People in urgent situations often have trouble finding local volunteers. BloodLink lets users create private accounts, publish donor profiles, search available donors by group and location, submit requests, respond to matching open requests, and track activity from a dashboard.

## Features

- Responsive HTML/CSS/vanilla JavaScript pages; browser operations use `fetch()`.
- Native Node.js HTTP server with REST JSON endpoints and PostgreSQL via `pg`.
- Passwords hashed with Node's scrypt; random session tokens are stored as SHA-256 hashes in PostgreSQL and sent in HttpOnly SameSite=Lax cookies.
- Donor profile create/update/delete, availability, and contact preference. Search only returns active, available profiles. Phone is returned only when the donor selected phone sharing; otherwise the requester can coordinate through enquiries.
- Blood requests, unique UUID request IDs, donor responses, request owner controls, dashboard notifications, and role-protected admin request management.
- Database-backed homepage statistics.
- Emergency notice: contact a hospital or licensed blood bank immediately.

## Technology and structure

- Frontend: HTML5, CSS3, vanilla JavaScript
- Backend: Node.js built-in `http` module
- Database: PostgreSQL and SQL
- Runtime dependency: `pg`

```text
frontend/      Pages, styles, browser JavaScript
backend/       HTTP server, database pool, validation, auth middleware
database/      schema.sql and optional seed.sql
```

## Requirements

Install Node.js 18 or newer and PostgreSQL 14 or newer. Create an empty database named `bloodlink`. Windows commands below use PowerShell and assume `psql` is on PATH.

## Setup on Windows

```powershell
cd "C:\Users\koush\OneDrive\Desktop\Blood Doner Finder Project"
Copy-Item .env.example .env
```

Edit `.env` and set `DATABASE_URL` to your local PostgreSQL user, password, host, and database. Example:

```text
DATABASE_URL=postgresql://postgres:your_password@localhost:5432/bloodlink
```

Create the database and apply the schema:

```powershell
createdb -U postgres bloodlink
psql -U postgres -d bloodlink -f database/schema.sql
```

Install and run:

```powershell
npm install
npm start
```

Open <http://localhost:3000>. The Node server hosts both the API and frontend. Check database connectivity at <http://localhost:3000/api/health>.

### This workspace's PostgreSQL service

In this workspace PostgreSQL runs inside the `OpenClawGateway` Ubuntu WSL distribution. If the database is unavailable after a WSL restart, start its cluster from PowerShell:

```powershell
wsl -d OpenClawGateway -u root -- pg_ctlcluster 16 main start
```

The local `.env` contains the app-role connection URL. Keep it private; it is excluded by `.gitignore`.

Set `COOKIE_SECURE=true` only when deployed behind HTTPS. `SESSION_DAYS` controls the session lifetime (default 7 days). Optional `PGSSL=true` enables TLS database connections without certificate validation; production should use a trusted certificate configuration.

## Admin setup

Registration intentionally never accepts a role field. To promote a trusted account, register normally, then run this in `psql`:

```sql
UPDATE users SET role = 'admin' WHERE email = 'admin@example.com';
```

Sign out and back in so the session reflects the role. Never expose database access to ordinary users.

## API overview

All request/response bodies are JSON. Authentication uses the HttpOnly session cookie; send same-origin requests. Errors use `{ "error": "..." }`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health`, `/api/stats` | Database health and live counts |
| POST | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Account and session management |
| GET | `/api/auth/me`, `/api/dashboard` | Current user and dashboard |
| GET/POST | `/api/donors` | Search available donors / create or update own profile |
| GET/PUT/DELETE | `/api/donors/:id` | View, update availability, or remove owned profile |
| GET/POST | `/api/requests` | Browse open requests / create request |
| GET | `/api/requests/my` | Current user's requests |
| GET/PUT/DELETE | `/api/requests/:id` | View or manage owned request |
| POST | `/api/enquiries` | Respond as an active donor to a matching open request |
| GET | `/api/enquiries/my` | Enquiries involving current user |
| PUT | `/api/enquiries/:id/status` | Request owner accepts/declines enquiry |
| GET | `/api/admin/dashboard`, `/api/admin/users`, `/api/admin/requests` | Admin data |
| PUT | `/api/admin/requests/:id/status` | Admin request moderation |
| PUT | `/api/admin/donors/:id/active` | Admin activates/deactivates donor |

## Screenshots

No screenshots are included yet. Run the application locally to capture current pages.

## Security limitations and future improvements

This is a demonstration project. Deploy only behind HTTPS, use a strong database password and least-privilege database account, configure trusted PostgreSQL TLS, set secure cookies, add rate limiting and CSRF defenses, email verification, password reset, audit logs, and monitored backups before real-world use. SameSite cookies and same-origin hosting reduce some cross-site risks but do not replace a full CSRF strategy. PostgreSQL errors are logged server-side; API errors avoid exposing SQL details. Admin role changes require trusted direct database access. No medical eligibility or blood compatibility logic is performed.

Future work: report review workflow, verified hospital accounts, email/SMS notification providers, location radius search, rate limiting, audit trail, and deployment monitoring.
