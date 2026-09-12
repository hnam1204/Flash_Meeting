# FLASH MEETING

FLASH MEETING is a Vanilla JavaScript + Vite foundation for realtime meetings. The planned production architecture is GitHub Pages for the public frontend, Supabase for authentication/application data, and LiveKit for WebRTC media.

## Current scope

This repository currently contains Phase 1 only:

- Multi-page Vite app with responsive HTML/CSS/ES module entry points.
- Public runtime configuration and Supabase/LiveKit client foundations.
- Page-level meeting flow placeholders: create, join, prejoin, waiting room, meeting, and ended states.
- Supabase migration/function scaffolds with explicit server-authority boundaries.
- GitHub Pages workflow using the repository name as the default project-site base path.

Production authentication, database schema, RLS, LiveKit token generation, realtime events, chat, moderation, and security hardening are intentionally reserved for later phases.

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
index.html and page entry points  Static multi-page UI
css/                              Shared and page-specific styles
js/                               Page modules and integration foundations
supabase/migrations/              Ordered database/RLS/security placeholders
supabase/functions/               Server-authority function placeholders
.github/workflows/                GitHub Pages deployment
```

## Security boundary

The browser is untrusted. Frontend role flags only control presentation. Sensitive actions must be authorized by Supabase RLS or Edge Functions, and LiveKit tokens must be signed server-side. Messages must be rendered as text, never as raw user HTML.

## Specification

For the complete architecture, security model, rollout order, and acceptance criteria, see `FLASH_MEETING_AI_IMPLEMENTATION.md`.
