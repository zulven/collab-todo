# collab-todo

## Architecture overview

This repository is a production-minded monorepo for a collaborative todo application.

- **Frontend**: React + TypeScript
- **Backend**: Express + TypeScript
- **Auth/Data**: Firebase Auth + Firestore

At a high level:

- The frontend is a single-page app that authenticates users and calls backend APIs.
- The backend exposes an HTTP API and is responsible for authorization and server-side validation.
- Firestore is the system of record for application data; Firebase Auth is the identity provider.

Responsibilities and rationale:

- Frontend (React)
  - Handles user interaction and presentation.
  - Authenticates users via Firebase Auth and obtains Firebase ID tokens.
  - Calls backend APIs and sends ID tokens in `Authorization: Bearer <token>`.
  - Does not write directly to Firestore (simplifies authorization and validation).

- Backend (Express)
  - Verifies Firebase ID tokens using Firebase Admin SDK.
  - Enforces authorization rules (owner/assignee permissions) and performs server-side validation.
  - Writes application data to Firestore (authoritative access path).
  - Provides a stable API surface independent of Firestore document shape changes.

- Firestore security rules
  - Treated as a second layer of defense.
  - Client writes are denied; reads are restricted to the authenticated user's own/assigned documents.

Realtime updates (tools considered):

- Option A: Firestore client subscriptions (`onSnapshot`) for realtime reads
  - Pro: minimal backend complexity; realtime UI updates.
  - Con: requires careful security rules and data modeling; still keep client writes disabled.

- Option B: Backend-mediated realtime (Firestore listener -> WebSockets/SSE)
  - Pro: backend remains the single integration point; consistent authorization.
  - Con: more infrastructure and code complexity.

Current choice:

- The current implementation uses backend APIs for reads/writes.
- Realtime can be added either by polling or by implementing Option A (client `onSnapshot` for read-only updates) while keeping writes in the backend.

## Features implemented

- User authentication via Firebase Auth (Google sign-in)
- Backend verification of Firebase ID tokens (Firebase Admin)
- TODO CRUD (create/update/delete)
- Ownership + visibility rules
  - Users can see tasks they own or that are assigned to them
  - Owner-only delete (documented by implementation)
- Collaboration
  - Assign tasks to other users using a searchable user picker (search by name/email)
  - Users become searchable after signing in once (backend upserts `users/{uid}`)
- Task fields
  - `title`, `description` (plain text), `status`, `priority`, `createdByUid`, `ownerUid`, `assigneeUids`
- Ordering
  - Shared ordering persisted to Firestore via `position`
  - UI supports drag-and-drop reorder (persists via backend)
- UI theme

## Project structure

Monorepo layout (npm workspaces):

```text
apps/
  frontend/           # React app (scaffold)
  backend/            # Express API (minimal /health)
packages/
  shared/             # Shared TypeScript types/utilities (scaffold)
```

Notes:

- `packages/shared` is intended to hold shared types (DTOs), validation helpers, and other utilities used by both frontend and backend.
- `apps/` contains runnable applications.

## Security model (draft)

This section is a draft and will evolve as implementation lands.

- **Identity**
  - Users authenticate via Firebase Auth.
  - The backend should verify Firebase ID tokens on every authenticated request.

- **Authorization**
  - Authorization is enforced server-side (backend), based on the authenticated user identity.
  - Firestore security rules should be treated as a second layer of defense, not the only enforcement point.

- **Data access boundaries**
  - Prefer a backend-mediated access model for sensitive operations.
  - Minimize client direct writes where it complicates authorization, auditing, or validation.

- **Secrets/config**
  - No secrets are committed to the repo.
  - Environment variables are used for configuration.
  - Separate configs per environment (local/dev/staging/prod).

## Local setup

Prerequisites:

- Node.js (LTS recommended)
- npm (workspaces enabled)

Install dependencies:

```bash
npm install
```

Typecheck all workspaces:

```bash
npm run typecheck
```

Build all workspaces:

```bash
npm run build
```

Run the apps locally:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

Notes:

- The frontend dev server runs on `http://localhost:5173`.
- The backend runs on `http://localhost:3000`.
- During local development, the frontend proxies API requests via Vite:
  - `GET /api/*` (frontend) -> `http://localhost:3000/*` (backend)
  - Example: `GET /api/health` calls the backend `GET /health` endpoint.

Backend API (selected):

- `GET /todos`
- `POST /todos`
- `PATCH /todos/:id`
- `DELETE /todos/:id`
- `PATCH /todos/reorder`
- `POST /users/me` (upsert profile for search)
- `GET /users?q=...` (search users)
- `POST /users/lookup` (resolve UIDs -> profiles)

Firebase (local emulators):

```bash
firebase emulators:start
```

Firebase Auth (Google sign-in):

- Create a Firebase **Web App** in the Firebase Console (Project settings -> Your apps).
- Copy `apps/frontend/.env.example` to `apps/frontend/.env` and fill in:
  - `VITE_FIREBASE_API_KEY`
  - `VITE_FIREBASE_AUTH_DOMAIN`
  - `VITE_FIREBASE_PROJECT_ID`
  - `VITE_FIREBASE_APP_ID`
- Restart the frontend dev server after changing `.env`.

Backend Firebase Admin (verifying ID tokens):

- Create a **service account** in Google Cloud Console (Project settings -> Service accounts) and download the JSON key.
- Do **not** commit the JSON file to the repository.
- Set the environment variable `GOOGLE_APPLICATION_CREDENTIALS` to the path of the JSON file before running the backend.

Firebase Hosting note:

- Hosting is configured with `public: apps/frontend/dist`.
- Once the frontend build tooling is added and it outputs to `apps/frontend/dist`, you can deploy with:

```bash
firebase deploy
```

Next steps (not included in the current scaffold):

- Add realtime updates (Firestore subscriptions or backend-mediated SSE/WebSockets)
- Add “lists/projects” for true shared boards (so multiple users can see the exact same unassigned tasks)
- Add richer task fields (due date, tags) and filters/views