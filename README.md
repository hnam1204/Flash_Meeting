# FLASH MEETING

FLASH MEETING is a Vanilla JavaScript + Vite realtime meeting application. The frontend is hosted on GitHub Pages, Supabase provides authentication and meeting data/realtime RPCs, and LiveKit provides WebRTC media transport.

## Current scope

The current repository includes the following production paths and foundations:

- Multi-page Vite app with responsive HTML/CSS/ES module entry points.
- Google OAuth authentication with a six-hour local session policy and protected routes.
- Supabase-backed account profiles, meeting lifecycle, analytics, realtime participant/chat state, and RLS migrations.
- LiveKit token requests, camera/microphone media, participant presence, and screen-share integration.
- Page-level meeting flow: create, join, prejoin, optional waiting room, meeting, and ended states.
- GitHub Pages workflow using the repository name as the default project-site base path.

Some server-authority operations remain explicit failure/scaffold boundaries until their corresponding Supabase RPC or Edge Function is deployed. The browser never fabricates meeting, participant, chat, or media state when a backend service is unavailable.

## Requirements

- Node.js 22 or newer
- npm

## Install and run

```powershell
npm install
npm run dev
```

Create `.env.local` from `.env.example` when public service configuration is available. Never put Supabase service-role credentials, LiveKit API secrets, or other server secrets in this file or in frontend code.

## Build

```powershell
npm run build
npm run preview
```

The production output is written to `dist/`.

## Project structure

```text
index.html and page entry points  Static multi-page UI and meeting routes
css/                              Shared and page-specific styles
js/                               Page modules and Supabase/LiveKit integrations
supabase/migrations/              Ordered database, RLS, analytics, and realtime history
supabase/functions/               Server-authority Edge Functions and retained scaffolds
.github/workflows/                GitHub Pages deployment
```

## Security boundary

The browser is untrusted. Frontend role flags only control presentation. Sensitive actions must be authorized by Supabase RLS or Edge Functions, and LiveKit tokens must be signed server-side. Messages must be rendered as text, never as raw user HTML.

## Specification

For the complete architecture, security model, rollout order, and acceptance criteria, see `FLASH_MEETING_AI_IMPLEMENTATION.md`.
