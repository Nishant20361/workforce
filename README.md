# WorkForce

WorkForce is a React 18 + FastAPI + MongoDB application for multi-business worker management, attendance payroll, payments, extra work, Worker View, and private owner/worker chat.

## Development

Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to `frontend/.env`. Keep both files uncommitted.

```bash
backend/venv/bin/uvicorn backend.server:app --reload --port 8000
cd frontend && npm start
```

Legacy password login is disabled by default. If it is temporarily needed on a private development machine, explicitly set `ALLOW_LEGACY_ADMIN_LOGIN=true` together with development-only `ADMIN_EMAIL` and `ADMIN_PASSWORD`. Never enable it in production.

## Production configuration

Backend variables:

```text
ENVIRONMENT MONGO_URL DB_NAME JWT_SECRET CORS_ORIGINS FRONTEND_URL
BUSINESS_TIMEZONE GOOGLE_CLIENT_ID MEDIA_STORAGE
CLOUDINARY_CLOUD_NAME CLOUDINARY_API_KEY CLOUDINARY_API_SECRET
COOKIE_SECURE COOKIE_SAMESITE SESSION_MAX_AGE_SECONDS
ALLOW_LEGACY_ADMIN_LOGIN
```

Frontend variables:

```text
REACT_APP_BACKEND_URL REACT_APP_GOOGLE_CLIENT_ID
```

Set `ENVIRONMENT=production`, `MEDIA_STORAGE=cloudinary`, `COOKIE_SECURE=true`, and an explicit HTTPS `CORS_ORIGINS` allowlist. Cross-origin deployments normally require `COOKIE_SAMESITE=none`; same-site deployments can use `lax`. The frontend and backend Google client IDs must identify the same Google OAuth Web client. Production startup fails when required configuration is absent or unsafe.

### Google Identity Services

Create an OAuth 2.0 **Web application** in Google Cloud Console. Add every frontend URL (for example, `https://app.example.com`) under Authorized JavaScript origins. This implementation uses the Google Identity Services credential callback and does not use an OAuth redirect URI or a client secret. Put the public client ID in both `REACT_APP_GOOGLE_CLIENT_ID` and backend `GOOGLE_CLIENT_ID`.

### Cloudinary private voice media

Copy the Cloud name, API key, and API secret from the Cloudinary dashboard/API Keys page into the backend production environment as `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`. Never place the API secret in React. Voice assets are uploaded as authenticated Cloudinary resources; the API checks the session, tenant, worker, conversation, and message, then proxies the authorized media without exposing its Cloudinary delivery URL.

Unsent recordings remain browser-only. Uploaded but unsent assets are retained for operational cleanup; sent message audio is retained as audit history. A future scheduled retention job may remove orphan assets after a documented retention period—there is intentionally no destructive automatic cleanup today.

### MongoDB and backups

Use a managed MongoDB deployment with provider backups and point-in-time recovery enabled. Startup verifies indexes and readiness checks MongoDB with `ping`. Existing duplicate data is never automatically deleted when an index conflicts; the conflict is logged for manual resolution. Do not create local backups of private production worker data.

### Build and run

```bash
cd frontend && npm ci && npm run build
PORT=8000 backend/venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Use the platform-provided `PORT` value where applicable. Do not use `--reload` in production. Serve `frontend/build` from static HTTPS hosting.

Health checks:

```text
GET /api/health  process liveness
GET /api/ready   MongoDB readiness
```

## Security model

Google ID tokens are verified server-side for signature validity through Google's token verification endpoint, audience, and verified email. Application sessions use short-lived Secure, HttpOnly cookies; CSRF uses a separate double-submit token header. Tenant identity always comes from the authenticated session. Worker sessions are bound to one concrete worker and business; ambiguous duplicate emails across businesses are rejected pending an owner-issued workspace invitation flow. Financial transactions are soft-deleted and excluded from totals.

Business calendar dates use `Asia/Kolkata` by default. Attendance may be backdated but not future-dated, and the unique `(business_id, worker_id, date)` index makes attendance upserts idempotent. Payroll uses calendar days in the month and Decimal half-up currency rounding.

See [PROJECT_HANDOFF.md](./PROJECT_HANDOFF.md) for the historical architecture description; where it differs, this README and the current code are authoritative.
# workforce
# workforce
