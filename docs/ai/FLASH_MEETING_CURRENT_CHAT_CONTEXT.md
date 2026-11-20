# FLASH MEETING — CURRENT CHAT CONTEXT

> Tài liệu này ghi lại bối cảnh kỹ thuật của toàn bộ chuỗi trao đổi hiện tại để một AI/developer khác có thể tiếp tục công việc mà không phải nghiên cứu lại từ đầu.
>
> Đây là context của conversation, không thay thế source code. Khi có khác biệt, source code hiện tại là nguồn sự thật cho trạng thái triển khai.

## 1. Metadata

- Product: `FLASH MEETING`
- Repository: `https://github.com/hnam1204/Flash_Meeting`
- Project root: `D:\ĐỒ ÁN WEBSITE\FLASH MEETING`
- Production URL: `https://hnam1204.github.io/Flash_Meeting/`
- Supabase project ref: `kriymwpoiondtgqyqxsq`
- Working branch at the time of writing: `main`
- Current HEAD when this context was created: `a12c6fb5e85fc90b3d5483e4305e3535148ebd02`
- Current HEAD message: `feat: harden production meeting lifecycle and realtime flows`
- Context date: `2026-10-11`
- Timezone for user-facing dates: `Asia/Bangkok`

Before this document was created, the worktree was clean and `HEAD` matched `origin/main`. Creating this file intentionally adds one new documentation file to the worktree.

## 2. Purpose Of This File

The conversation covered many implementation phases. The goal of this file is to preserve:

1. the product and architecture decisions already made;
2. the distinction between user instructions and attached planning documents;
3. the protected Supabase/LiveKit work;
4. the current route and module graph;
5. the production cleanup that has already been completed;
6. validation results and known limitations;
7. safe continuation rules for future work.

Do not interpret this file as authorization to redesign, deploy, reset, push, or modify backend infrastructure. It is a handoff document.

## 3. Conversation Scope And Instruction Precedence

### 3.1 Explicit user requests

The user has repeatedly requested implementation and hardening of the FLASH MEETING frontend and integrations, including:

- login screen implementation;
- home/dashboard screen implementation and redesign;
- create meeting screen;
- join meeting screen;
- pre-join screen with real local camera/microphone preview;
- waiting room screen and host waiting-room behavior;
- meeting room normal state;
- screen-share state;
- participants panel and host permissions;
- leave-meeting result screen;
- auth screen rebuild;
- Google OAuth-only authentication;
- auth guard and session expiry policy;
- Supabase Phase 0 connection;
- Supabase Account Phase 1 profiles/RLS/real register integration;
- orange-white global UI redesign;
- dashboard and waiting-room redesign;
- real local media, screen share, and silent session behavior;
- simplified account menu/header;
- typography and responsive readability improvements;
- instant meeting flow;
- GitHub Pages production environment repair;
- production codebase cleanup and hardening.

The most recent substantive task in the conversation was:

> Remove mock/demo/sample runtime behavior, remove only proven dead code/files, preserve real Supabase/LiveKit functionality, audit the entire repository, validate the build, and produce an auditable cleanup report.

### 3.2 Attached and pasted documents

The conversation included attached Markdown files and pasted prompts. They are context/specification material, not independent authorities. Relevant documents include:

- `FLASH_MEETING_AI_IMPLEMENTATION.md`
- `docs/ai/FLASH_MEETING_DEEP_PROJECT_KNOWLEDGE_INGESTION.md`
- `FLASH_POS_DESIGN_CONTEXT.md` supplied from the user Downloads folder
- several pasted task prompts stored by the Codex app under `.codex/attachments/`

The documents describe intended architecture, design, rollout phases, and acceptance criteria. They must not be treated as proof that a feature is implemented. The actual source is authoritative.

### 3.3 Conflict resolution rule

When a document, old prompt, or screenshot conflicts with the latest explicit user instruction:

1. follow the latest explicit user instruction;
2. preserve intentional existing work;
3. inspect the source before making assumptions;
4. document any remaining discrepancy;
5. do not silently restore old mock behavior just because an older specification describes it.

## 4. Protected Existing Work

The user explicitly required preservation of the following Supabase Account Phase 1B and later backend work.

### 4.1 Protected repository items

- `package.json`
- `package-lock.json`
  - Supabase CLI is intentionally installed as a local development dependency.
- `supabase/config.toml`
- `supabase/.gitignore`
- all applied timestamped migrations under `supabase/migrations/`
- `docs/archive/supabase-scaffold/`
  - contains the archived placeholder migrations `001`–`003`.
- all deployed or potentially deployed Supabase Edge Functions under `supabase/functions/`.
- current Supabase client configuration in `js/config.js` and `js/supabase-client.js`.
- current Google OAuth/session integration.
- current LiveKit token and media integration.

### 4.2 Current active migrations

The current repository contains these active migration files:

1. `supabase/migrations/20260913074238_account_profiles.sql`
2. `supabase/migrations/20260914120000_global_analytics.sql`
3. `supabase/migrations/20260914153000_realtime_meeting.sql`
4. `supabase/migrations/20260914160000_fix_realtime_room_policy_execute.sql`
5. `supabase/migrations/20260914163000_fix_participant_rejoin_identity.sql`
6. `supabase/migrations/20260914170000_require_participant_display_name.sql`
7. `supabase/migrations/20260914180000_meeting_idle_cleanup.sql`

Historical migrations are production history. Never delete, rename, reorder, repair, reset, or replace them without explicit authorization.

### 4.3 Forbidden operations unless explicitly requested later

- `supabase db push`
- `supabase db reset`
- migration repair
- database reset or destructive SQL
- deleting or modifying production data
- changing RLS/schema/Auth triggers
- modifying LiveKit backend integration or credentials
- committing or pushing Git changes
- reverting unrelated existing work
- using `git reset --hard` or `git clean -fd`

## 5. Product Architecture

FLASH MEETING is a multi-page Vanilla JavaScript application built with Vite.

```text
Browser
  |
  +-- GitHub Pages
  |     +-- Vite-generated HTML/CSS/ES modules
  |
  +-- Supabase
  |     +-- Google OAuth / Auth
  |     +-- profiles
  |     +-- meeting RPCs
  |     +-- RLS
  |     +-- Realtime participant/chat state
  |     +-- analytics
  |     +-- Edge Functions
  |
  +-- LiveKit
        +-- token issuance through Supabase Edge Function
        +-- camera and microphone tracks
        +-- participant presence
        +-- screen-share tracks
        +-- realtime room transport
```

### 5.1 Frontend

- HTML multi-page entries rather than a single SPA router.
- CSS is split into shared/base and page-specific files.
- JavaScript uses native ES modules.
- Vite controls multi-page inputs and the production base path.
- `lucide` supplies UI icons.
- `qrcode` is dynamically imported for invite QR rendering.

### 5.2 Auth and account data

- Google OAuth is the only supported authentication method.
- Gmail-only enforcement is present in the current auth service.
- User profile data is synchronized with Supabase `profiles`.
- Protected pages call the auth guard before exposing their primary UI.
- The local application session policy is six hours in production.
- A development-only `VITE_AUTH_SESSION_MAX_AGE_MS` override is documented in `.env.example`.
- `register.html` is a compatibility redirect to `login.html`; there is no separate password-registration flow.

### 5.3 Meeting data and authorization

- Meeting creation, lookup, join, start, end, waiting-room, participant, and moderation operations use Supabase RPC/service calls.
- The browser may render role-dependent UI, but server-side authorization remains authoritative.
- If the backend is unavailable, the frontend must show an explicit service/error state.
- It must never silently create a fake meeting or fake participant state.

### 5.4 Media

- Local camera and microphone use browser media APIs.
- Remote camera, microphone, and screen-share media use LiveKit tracks.
- LiveKit token requests use the `livekit-token` Supabase Edge Function.
- Screen-share UI supports real loading, recovering, failed, and ended states.
- There is no supported production path for synthetic remote presentation content.

## 6. Route Inventory

All current HTML pages are retained Vite inputs and are considered supported unless a future audit proves otherwise.

| Page | Purpose | Auth | Main module | CSS |
|---|---|---:|---|---|
| `index.html` | Authenticated dashboard/home | Required | `js/home.js` | `base.css`, `home.css` |
| `login.html` | Google OAuth login | Public | `js/auth.js` | `base.css`, `auth.css` |
| `register.html` | Compatibility redirect to login | Public | inline redirect + analytics | `base.css`, `auth.css` |
| `create-meeting.html` | Explicit meeting creation form | Required | `js/meeting-create.js` | `base.css`, `meeting-form.css` |
| `join-meeting.html` | Room code and display-name entry | Auth-aware | `js/meeting-join.js` | `base.css`, `meeting-form.css` |
| `prejoin.html` | Local device preview and admission handoff | Required | `js/meeting-prejoin.js` | `base.css`, `prejoin.css` |
| `waiting-room.html` | Optional backend-controlled waiting state | Required | `js/meeting-waiting-room.js` | `base.css`, `waiting-room.css` |
| `meeting.html` | Live meeting room | Required | `js/meeting-room.js` | `base.css`, `meeting.css` |
| `meeting-ended.html` | Canonical leave/end result state | Public/transition | `js/meeting-ended.js` | `base.css`, `meeting.css` |
| `404.html` | GitHub Pages not-found handling | Public | analytics only | `base.css`, `meeting.css` |

### 6.1 Canonical flow

```text
Google login
  -> dashboard
  -> instant meeting or create-meeting.html
  -> prejoin.html
  -> meeting.html

Google login
  -> join-meeting.html?room=<CODE>
  -> prejoin.html?room=<CODE>
  -> meeting.html?room=<CODE>

Prejoin admission result
  -> meeting.html
  -> waiting-room.html when the authoritative meeting requires approval

Meeting exit or host termination
  -> meeting-ended.html or dashboard according to lifecycle result
```

### 6.2 Supported URL parameters

Legitimate query parameters are limited to:

- `room`: meeting invite/deep-link room code;
- `next`: safe local post-auth redirect;
- `reason=session_expired`: login messaging;
- `from=waiting`: waiting-room return context.

The former public mock/demo parameters such as `mock`, `demo`, `scenario`, `participants`, `room-full`, `camera-off`, `mic-off`, and `remote-share` are not part of the production runtime.

## 7. Module Inventory

### 7.1 Auth and configuration

- `js/config.js`
  - Reads browser-safe `VITE_*` configuration.
  - Exposes `configState` for Supabase, LiveKit, and Turnstile availability.
- `js/supabase-client.js`
  - Creates the Supabase client only when public URL/key configuration exists.
  - Keeps connection configuration centralized.
- `js/auth-session.js`
  - Stores and validates local auth-session metadata.
  - Enforces the six-hour production expiry policy.
- `js/auth-service.js`
  - Bootstraps and verifies Supabase Auth sessions.
  - Enforces Google/Gmail identity rules.
  - Synchronizes profile display names.
  - Owns sign-in, sign-out, next-route, and callback handling.
- `js/auth-guard.js`
  - Protects authenticated pages.
  - Redirects unauthenticated or expired sessions to login.
- `js/auth.js`
  - Owns the login page UI and Google sign-in button state.
- `js/display-name.js`
  - Normalizes and validates required meeting display names.
  - Rejects generic values such as `guest`, `anonymous`, `unknown`, and equivalent fallback labels.

### 7.2 Dashboard and analytics

- `js/home.js`
  - Dashboard rendering, account menu, instant meeting action, active meeting refresh, history display, and analytics panel wiring.
- `js/dashboard-service.js`
  - Loads current user, active meetings, and meeting history through the real meeting service.
- `js/app-analytics.js`
  - Visit tracking, analytics panel state, refresh/retry UI, and chart coordination.
- `js/analytics-service.js`
  - Supabase-backed visit/global analytics operations.
- `js/analytics-chart.js`
  - SVG chart rendering.

### 7.3 Meeting service and entry flows

- `js/meeting-service.js`
  - Central meeting service contract.
  - Normalizes remote meetings.
  - Calls authoritative Supabase RPCs.
  - Maps backend errors.
  - Manages admission destinations and waiting-room state.
  - Stores only legitimate short-lived transition context in session storage.
- `js/meeting-create.js`
  - Explicit create form and redirect to prejoin.
- `js/meeting-join.js`
  - Room code validation, display-name validation, invite prefill, and join resolution.
- `js/meeting-prejoin.js`
  - Local camera/microphone preview.
  - Device availability and preferences.
  - Host start or participant admission.
  - Redirects to meeting or waiting room based on backend result.
- `js/meeting-waiting-room.js`
  - Waiting request state, realtime approval/rejection/leave handling, and transition to meeting.
- `js/meeting-ended.js`
  - Renders lifecycle result details from legitimate session transition data.

### 7.4 Meeting room modules

- `js/meeting-room.js`
  - Meeting page coordinator and lifecycle controller.
  - Connects realtime business state, LiveKit, media, participants, chat, panels, host actions, screen share, recording, and cleanup.
- `js/meeting-realtime.js`
  - Supabase Realtime participant/message subscriptions.
  - Meeting updates and media-state operations.
  - LiveKit token request through Edge Functions.
- `js/livekit-client.js`
  - Creates/configures a LiveKit room and connects it with the public LiveKit URL.
- `js/livekit-room-controller.js`
  - Wraps LiveKit room events, participant snapshots, tracks, publications, data messages, and reconnection.
- `js/meeting-media.js`
  - Local camera/microphone preferences and media controller.
- `js/meeting-participants.js`
  - Participant store, role labels, filters, and role counts.
- `js/meeting-participant-grid.js`
  - Dynamic participant grid/filmstrip rendering from real participant state.
- `js/meeting-host-controls.js`
  - UI-level host/co-host action availability and request payloads.
  - Server remains authoritative.
- `js/meeting-chat.js`
  - Safe text-only rendering of realtime chat messages.
  - Message persistence/subscription is owned by `meeting-realtime.js`.
- `js/meeting-activity-feed.js`
  - Real participant join/leave/removal/screen-share activity notices.
- `js/meeting-screen-share.js`
  - Local browser screen-share capture lifecycle.
- `js/meeting-screen-share-state.js`
  - Shared track-source and remote screen-share media state normalization.
- `js/meeting-recording.js`
  - Browser-side recording lifecycle and local download handling.
- `js/meeting-invite.js`
  - Invite URL, copy, and QR generation.
- `js/meeting-mobile-actions.js`
  - Mobile meeting toolbar actions.
- `js/meeting-security.js`
  - Previously existed as an unreferenced helper and was removed after the reference audit proved it unreachable.

### 7.5 Shared UI modules

- `js/utils.js`: route/base-path helpers, room-code normalization, status helpers, invite URL creation.
- `js/ui/icons.js`: Lucide icon rendering and replacement.
- `js/ui/modal-manager.js`: accessible modal state, focus handling, confirmation, processing, success, error, and info dialogs.

## 8. Production Cleanup Already Completed

The production cleanup was implemented in the commit currently at `HEAD`.

### 8.1 Removed fake runtime behavior

The following behavior was removed from the production runtime:

- synthetic demo meetings;
- local fake meeting records and fake history;
- fake meeting creation success when Supabase was unavailable;
- fake participant arrays and static participant names;
- fake participant counts such as `24` or synthetic `50`-person scenarios;
- static chat messages;
- static waiting users;
- mock room scenarios selected through query parameters;
- mock rate-limit/network/service/room-full/camera-off/mic-off scenarios;
- fake meeting timers and invented `startedAt` values;
- fake remote screen-share presenters and presentation content;
- default invented room codes such as `ABC-123-XYZ`;
- generic fallback identity admission into real meetings.

### 8.2 Real-service behavior after cleanup

The current service behavior is:

```text
validate input
  -> require authenticated user where applicable
  -> require public Supabase configuration
  -> call authoritative RPC/Edge Function
  -> normalize remote response
  -> return real success or explicit error
```

If Supabase or LiveKit is unavailable, the application reports a service/configuration/error state. It does not manufacture a successful meeting or participant list.

### 8.3 Identity hardening

Stored participant transition context is accepted only when its `userId`/`user_id` matches the currently authenticated user. A stored participant record with only an arbitrary local `id` is not sufficient for admission or role reconstruction.

This check is in `js/meeting-service.js`, inside `getStoredParticipant()`.

### 8.4 Dead code removal

`js/meeting-security.js` was removed because the audit found:

- no static import;
- no dynamic import;
- no HTML script reference;
- no navigation reference;
- no runtime string reference;
- no caller for its exported function.

No HTML route, CSS file, asset, dependency, migration, or Edge Function was removed during the cleanup solely because it looked old or small.

## 9. Supabase And Edge Function Status

### 9.1 Implemented/current backend areas

- account profiles and auth profile synchronization;
- RLS/security history;
- analytics schema and RPCs;
- realtime meeting/participant/message operations;
- display-name enforcement migration;
- participant rejoin identity hardening;
- idle meeting cleanup migration;
- `livekit-token` Edge Function for authenticated LiveKit token issuance.

### 9.2 Retained scaffold functions

The following Edge Function directories remain and must not be deleted without proof of retirement:

- `meeting-create`
- `meeting-end`
- `meeting-join`
- `meeting-moderate`
- `meeting-settings`
- `meeting-token`
- `meeting-waiting-action`
- `security-event`

Several of these are explicit scaffold responses reserved for future phases. Their presence is intentional documentation of the server-authority boundary, not permission to replace the current frontend RPC path with fake behavior.

### 9.3 Server-side security boundary

- Frontend role flags control presentation only.
- Sensitive actions must be authorized through Supabase RLS/RPC/Edge Functions.
- LiveKit API key/secret values must stay server-side.
- Only browser-safe Supabase public values may be exposed to Vite.
- Chat content is rendered using `textContent`, never raw HTML.

## 10. GitHub Pages Deployment Context

The GitHub Actions workflow is `.github/workflows/deploy-pages.yml`.

The build step currently receives:

```yaml
VITE_BASE_PATH: /${{ github.event.repository.name }}/
VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
VITE_SUPABASE_PUBLISHABLE_KEY: ${{ secrets.VITE_SUPABASE_PUBLISHABLE_KEY }}
VITE_LIVEKIT_URL: ${{ secrets.VITE_LIVEKIT_URL }}
```

The dynamic base path resolves to `/Flash_Meeting/` for the repository site. It must not be replaced with an unnecessary hard-coded path.

`.env.local` is ignored by `.gitignore` and is not tracked. `.env.example` contains names only:

```text
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_LIVEKIT_URL=
VITE_TURNSTILE_SITE_KEY=
```

Required GitHub repository Actions secrets:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `VITE_LIVEKIT_URL` when LiveKit is enabled

The code cannot create GitHub repository secrets. A deployment is not considered fixed merely because the local build passes; GitHub Actions must rerun successfully with the repository secrets configured.

## 11. Package And Build Configuration

### 11.1 Scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

### 11.2 Runtime dependencies

- `@supabase/supabase-js`
- `livekit-client`
- `lucide`
- `qrcode`

### 11.3 Development dependencies

- `supabase`
- `vite`

No dependency was removed because each current package remains tied to an active feature or build path.

### 11.4 Vite inputs

`vite.config.js` explicitly includes all ten supported HTML entries:

- `index.html`
- `login.html`
- `register.html`
- `create-meeting.html`
- `join-meeting.html`
- `prejoin.html`
- `waiting-room.html`
- `meeting.html`
- `meeting-ended.html`
- `404.html`

The Vite `envPrefix` allows `VITE_*` and retained `NEXT_PUBLIC_*` public configuration names. Do not expose server-only secrets through either prefix.

## 12. Validation Results Recorded In This Conversation

The following checks passed during the cleanup work:

- `npm run build`: PASS.
- `node --check` for all JavaScript files: PASS.
- `git diff --check`: PASS.
- Vite base-path verification with `VITE_BASE_PATH=/Flash_Meeting/`: PASS.
- Current source scan for prohibited mock/demo/sample runtime markers: no prohibited markers found.
- `.env.local` tracking check: not tracked.
- Supabase migrations/functions retained.

Recorded bundle size after cleanup:

- meeting chunk: approximately `680.95 kB` minified;
- gzip: approximately `181.68 kB`.

Vite still reports the existing large-chunk warning for the meeting bundle. This is a performance follow-up, not a build failure.

## 13. Legitimate Remaining Terms

Do not remove the following merely because a broad keyword scan finds them:

- `placeholder`
  - Used for real empty/loading/device-off UI states and HTML input hints.
- `camera-off`, `mic-off`, `room-full`
  - Real media or admission states, not mock query scenarios.
- `guest`, `anonymous`, `unknown`, `gmail user`, `khách tham gia`
  - Reserved invalid display-name values used by validation logic and server-side rejection.
- `demote`
  - A real host/co-host moderation action.
- scaffold/TODO text in retained Edge Functions and architecture documents
  - Documents or explicit server-boundary placeholders, not production fake data.
- `dist/verify/` if it exists locally
  - An ignored historical verification snapshot. It is not source and must not be used to judge the current top-level build.

## 14. Manual Regression Tests Still Required

Static validation does not prove every browser/backend flow. Before calling the product production-ready, manually test:

### Authentication

- Google login with a valid Gmail account.
- Non-Gmail or non-Google rejection.
- OAuth callback with a safe `next` route.
- Session expiry after the configured lifetime.
- Logout and storage cleanup.

### Dashboard

- Dashboard load with valid Supabase configuration.
- Active/history meeting RPC failures.
- Instant meeting creation.
- Account menu and profile display.
- Dashboard refresh after meeting start/end events.

### Meeting admission

- Valid and invalid room codes.
- Invite URL `join-meeting.html?room=<CODE>`.
- Display-name validation and generic-name rejection.
- Host direct admission and host never waiting.
- Participant prejoin camera/microphone toggles.
- Waiting-room approval, rejection, withdrawal, reconnect, and session expiry.

### Live meeting

- LiveKit token issuance.
- Camera and microphone publish/unpublish.
- Remote participant join/leave/reconnect.
- Participant grid, speaker mode, active speaker, and mobile controls.
- Realtime chat and message recovery.
- Reactions and raise-hand state.
- Host mute/camera/remove/co-host/share-permission actions.
- Local screen share.
- Remote screen-share subscription, recovery, failure, and end state.
- Browser recording and local save.
- Host ending the meeting for everyone.
- Participant leaving while the meeting continues.
- Meeting idle cleanup after the configured timeout.

### Deployment

- GitHub Actions build with repository secrets configured.
- GitHub Pages paths under `/Flash_Meeting/`.
- Direct loading of `/`, `/login.html`, `/join-meeting.html`, `/prejoin.html`, `/meeting.html`, `/meeting-ended.html`.
- 404 handling and refresh/deep-link behavior.
- Desktop, mobile, Chrome, Edge, Safari, and Firefox where supported.

## 15. Safe Continuation Rules

Any future agent should begin with:

```powershell
Set-Location "D:\ĐỒ ÁN WEBSITE\FLASH MEETING"
Get-Location
git status --short
git branch --show-current
git diff --check
```

Then inspect the relevant source and current HEAD. Do not assume that an old prompt or attached screenshot reflects the current implementation.

Before deleting anything, prove it is unused through:

- static imports;
- dynamic imports;
- HTML script references;
- navigation strings and `getPageUrl()` calls;
- Vite inputs;
- CSS `url(...)` references;
- asset references;
- Edge Function references;
- operational documentation;
- runtime string references.

When uncertain, keep the file and document the uncertainty.

Do not modify unrelated screens or architecture while performing a scoped fix. Do not reintroduce demo state to make a backend failure look successful.

## 16. Recommended Next Steps

The next work should be selected explicitly rather than inferred:

1. Run the manual browser/backend regression matrix above.
2. Verify the latest GitHub Actions deployment with real repository secrets.
3. Review the large `meeting` bundle and introduce safe code splitting only if performance work is requested.
4. Implement remaining retained Supabase Edge Function scaffolds only as a separate backend-authorized phase.
5. Keep the current active migration history unchanged.

## 17. Final Handoff Summary

FLASH MEETING has moved from a visual/mock prototype toward a real Supabase + LiveKit meeting application. The production cleanup removed fabricated runtime state and preserved supported routes, real backend boundaries, migrations, auth, analytics, realtime, media, screen sharing, recording, and deployment configuration.

The most important invariant is:

```text
real backend/media success
OR
explicit user-visible error

Never silent fake success.
```

