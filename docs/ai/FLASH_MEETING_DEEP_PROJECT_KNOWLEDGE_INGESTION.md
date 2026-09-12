# FLASH MEETING — DEEP PROJECT KNOWLEDGE INGESTION + MEMORY UPDATE
# READ FIRST — UNDERSTAND ARCHITECTURE — VERIFY SOURCE — UPDATE PROJECT KNOWLEDGE
# FRONTEND + UX + MEETING DOMAIN + SUPABASE + LIVEKIT + SECURITY + DEPLOYMENT
# DO NOT CODE
# DO NOT MODIFY SOURCE
# DO NOT GUESS
# SOURCE OF TRUTH = CURRENT FLASH MEETING PROJECT

---

# 0. MISSION

Bạn đang tiếp nhận một dự án đang được phát triển:

FLASH MEETING

Project root:

D:\ĐỒ ÁN WEBSITE\FLASH MEETING

Nhiệm vụ trong lượt này KHÔNG phải code.

Nhiệm vụ là:

1. đọc project chuyên sâu;
2. hiểu chính xác cấu trúc hiện tại;
3. hiểu kiến trúc frontend hiện tại;
4. hiểu luồng nghiệp vụ meeting;
5. hiểu toàn bộ UI/UX đã được triển khai;
6. xác minh Design System thực tế từ source;
7. xác minh mock architecture hiện tại;
8. xác minh Supabase hiện ở mức scaffold hay implementation;
9. xác minh LiveKit hiện ở mức scaffold hay implementation;
10. hiểu security boundary;
11. phân biệt IMPLEMENTED / PARTIAL / SCAFFOLD / MOCK / NOT IMPLEMENTED;
12. phát hiện khác biệt giữa tài liệu và source;
13. tạo architecture map;
14. tạo UX/business map;
15. tạo project knowledge summary chính xác;
16. chuẩn bị knowledge để các task sau không phải nghiên cứu lại từ đầu.

KHÔNG chỉnh source trong task này.

---

# 1. ABSOLUTE RULE — SOURCE OF TRUTH

SOURCE CODE HIỆN TẠI là source of truth.

Các tài liệu như:

FLASH_MEETING_AI_IMPLEMENTATION.md
README.md
prompt/spec khác
ảnh thiết kế
conversation context

chỉ là context định hướng.

Nếu source hiện tại khác tài liệu:

ƯU TIÊN SOURCE HIỆN TẠI.

Phải ghi rõ:

DOCUMENT SAYS:
[...]

SOURCE IMPLEMENTS:
[...]

DECISION:
Current source is authoritative for current implementation status.

Không được:

- tự suy đoán;
- invent feature;
- ghi scaffold thành implemented;
- ghi mock thành production;
- ghi UI tĩnh thành business flow hoàn chỉnh;
- ghi Supabase folder tồn tại thành backend đã hoạt động;
- ghi LiveKit dependency tồn tại thành WebRTC đã hoạt động;
- ghi screenshot data thành business rule;
- tự chọn màu/font canonical khi source chưa xác nhận;
- sửa file;
- chạy migration;
- connect production database;
- deploy Edge Functions;
- tạo user thật;
- reset project;
- cleanup source;
- install package;
- build nếu việc build có thể làm thay đổi source/lockfile;
- commit;
- push.

Task này là:

READ
ANALYZE
VERIFY
CLASSIFY
SUMMARIZE
PROJECT KNOWLEDGE UPDATE

ONLY.

---

# 2. VERIFY WORKSPACE FIRST

Đầu tiên xác minh:

D:\ĐỒ ÁN WEBSITE\FLASH MEETING

Không đọc nhầm project khác.

Kiểm tra:

Get-Location
Get-ChildItem -Force

Nếu path không đúng:

STOP.

Không ghi file.

Không tạo nested project như:

D:\ĐỒ ÁN WEBSITE\FLASH MEETING\flash-meeting

trừ khi source hiện tại thật sự dùng cấu trúc đó.

---

# 3. READ MASTER DOCUMENTATION

Audit tất cả tài liệu tồn tại trong root/project:

README.md
FLASH_MEETING_AI_IMPLEMENTATION.md
*.md
docs/**
package.json
package-lock.json
vite.config.*
.env.example
.gitignore
.github/workflows/**
supabase/**

Không giả định file tồn tại.

Chỉ đọc những file source thực tế có.

Xác định:

- tài liệu nào là current;
- tài liệu nào cũ;
- tài liệu nào chỉ là proposal;
- tài liệu nào đã bị source vượt qua;
- tài liệu nào còn là architecture baseline.

---

# 4. PROJECT DEVELOPMENT PHILOSOPHY

FLASH MEETING đang theo hướng:

FRONTEND-FIRST
+
BACKEND-AWARE

Expected development sequence conceptually:

Business Flow
→ Design System
→ UI Screens
→ Frontend Interaction
→ Mock Data / Mock Services
→ Data Contract Freeze
→ Supabase Schema
→ Supabase Auth
→ RLS
→ Edge Functions
→ Realtime
→ LiveKit
→ Integration
→ Security Hardening
→ Performance / Load Testing
→ Production

VERIFY actual source.

Không ghi sequence này thành current implementation status nếu project chưa đến phase đó.

---

# 5. CURRENT TARGET PRODUCT

FLASH MEETING là nền tảng họp trực tuyến web.

Target experience:

- đăng ký;
- đăng nhập;
- trang chủ/dashboard;
- tạo cuộc họp;
- tham gia cuộc họp;
- pre-join;
- camera/microphone device check;
- waiting room;
- host approval;
- realtime meeting;
- camera;
- microphone;
- screen share;
- participant list;
- active speaker;
- chat;
- reaction;
- raise hand;
- host/co-host moderation;
- meeting settings;
- leave meeting;
- end meeting for everyone;
- notifications;
- meeting history;
- recording metadata/file if later implemented.

Target scale direction:

50–100 participants / meeting.

IMPORTANT:

Target feature ≠ current implementation.

Audit source to classify each.

---

# 6. EXPECTED STACK — VERIFY SOURCE

Expected baseline:

Frontend:
HTML5
CSS3
Vanilla JavaScript
ES Modules
Vite

Website:
GitHub Pages

Backend:
Supabase

Database:
PostgreSQL via Supabase

Authentication:
Supabase Auth

Application Realtime:
Supabase Realtime

Storage:
Supabase Storage

Trusted server logic:
Supabase Edge Functions

Media:
LiveKit

Realtime media:
WebRTC

Media topology:
SFU

Expected optimization:
adaptiveStream
dynacast

BUT SOURCE DECIDES.

Verify package.json, imports, config and actual code.

Do not store expected stack item as implemented unless source confirms usage.

---

# 7. PROJECT STATUS CLASSIFICATION

Every important feature/module must be classified as one of:

IMPLEMENTED

PARTIAL

SCAFFOLD

MOCK

NOT IMPLEMENTED

UNKNOWN

Definitions:

IMPLEMENTED:
Feature has meaningful working source and required flow.

PARTIAL:
Some behavior exists but important flow is incomplete.

SCAFFOLD:
Files/folders/placeholders exist but production logic does not.

MOCK:
Frontend behavior intentionally simulates future backend/service.

NOT IMPLEMENTED:
No meaningful implementation found.

UNKNOWN:
Not enough source evidence.

Never collapse these categories.

---

# 8. READ PROJECT STRUCTURE FIRST

Build a complete source tree excluding:

node_modules
dist
.git

Audit at minimum:

HTML pages
css/
js/
assets/
supabase/
.github/
docs/ if any

Read:

package.json
vite.config.js
all HTML entry files
all JS modules
shared CSS
page CSS
Supabase migrations
Supabase functions
GitHub workflow
environment templates

Then construct:

CURRENT ARCHITECTURE MAP.

---

# 9. PAGE INVENTORY

Find actual pages/routes.

Expected examples may include:

index.html
login.html
register.html
create-meeting.html
join-meeting.html
prejoin.html
waiting-room.html
meeting.html
meeting-ended.html
forgot-password.html
reset-password.html
verify-email.html
404.html

Do not assume any exists.

For every page record:

Path:
[...]

Purpose:
[...]

Status:
IMPLEMENTED / PARTIAL / SCAFFOLD / MOCK / NOT IMPLEMENTED

Loaded CSS:
[...]

Loaded JS:
[...]

Navigation from:
[...]

Navigation to:
[...]

Authentication requirement:
[...]

Known limitations:
[...]

---

# 10. FRONTEND MODULE INVENTORY

Audit actual JS.

Expected examples may include:

config.js
supabase-client.js
auth.js
auth-service.js
home.js
dashboard-service.js
meeting-create.js
meeting-join.js
meeting-prejoin.js
meeting-waiting-room.js
meeting-room.js
meeting-media.js
meeting-screen-share.js
meeting-participants.js
meeting-chat.js
meeting-host-controls.js
meeting-security.js
livekit-client.js
utils.js

For every actual module record:

Responsibility:
[...]

Imports:
[...]

Exports:
[...]

State managed:
[...]

DOM ownership:
[...]

Mock vs real:
[...]

Cross-module coupling:
[...]

Security-sensitive behavior:
[...]

Potential architecture issue:
[...]

Do not invent missing modules.

---

# 11. FILE RESPONSIBILITY RULE

Check whether source follows:

ONE CLEAR FILE
=
ONE CLEAR RESPONSIBILITY

Good conceptual mapping:

meeting-chat.js
→ chat

meeting-media.js
→ camera/microphone

meeting-screen-share.js
→ presentation

meeting-participants.js
→ participant state/UI

meeting-host-controls.js
→ host moderation UI/request

livekit-client.js
→ media room connection abstraction

Identify violations such as:

script.js
main2.js
helper2.js
temp.js
final.js

or giant multi-responsibility files.

Do NOT refactor in this task.

Only report.

---

# 12. DEPENDENCY AUDIT

Read package.json/package-lock.

Record actual:

Production dependencies:
[...]

Development dependencies:
[...]

For each dependency:

Purpose:
[...]

Actually imported:
YES/NO

Potentially unused:
YES/NO/UNKNOWN

Critical:
YES/NO

Expected important packages may include:

@supabase/supabase-js
livekit-client
vite

Do not assume.

---

# 13. VITE ARCHITECTURE

Audit actual Vite configuration.

Understand:

- multi-page entries;
- base path;
- GitHub Pages behavior;
- custom domain readiness;
- asset output;
- public assets;
- build directory;
- dev server;
- aliases if any.

Verify whether all HTML screens are production build entries.

Important:

Development success ≠ GitHub Pages success.

Record potential path issues.

Do not modify vite.config.js.

---

# 14. GITHUB PAGES DEPLOYMENT

Audit:

.github/workflows/

Understand:

- trigger branch;
- Node version;
- install command;
- build command;
- Pages artifact;
- deploy action;
- permissions;
- concurrency.

Verify whether workflow deploys:

dist/

Verify whether Vite base matches GitHub Pages.

Classify deployment readiness:

READY
PARTIAL
NOT READY
UNKNOWN

Do not deploy.

---

# 15. ENVIRONMENT / PUBLIC CONFIG

Audit:

.env.example
config.js
Vite env usage

Determine public browser config model.

Expected public values may include:

VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_LIVEKIT_URL
VITE_TURNSTILE_SITE_KEY

Verify actual source.

Search for accidental secrets.

Do NOT print secret values.

Only report:

POTENTIAL SECRET FOUND
File:
[...]

Credential rotation required:
YES/NO/UNKNOWN

Never copy secret into report.

---

# 16. TRUST BOUNDARY — CRITICAL

Understand actual architecture boundary.

Expected philosophy:

Browser / GitHub Pages
=
UNTRUSTED

Supabase RLS
+
Edge Functions
=
SERVER AUTHORITY

LiveKit signed token
=
MEDIA AUTHORIZATION

Verify actual source.

Frontend role checks are UX only.

They must NOT be treated as security.

Audit any patterns such as:

if (role === "host")

and determine whether future/actual server authorization exists.

Record as:

UI VISIBILITY CHECK
or
REAL AUTHORIZATION

Do not confuse them.

---

# 17. LOGIN SCREEN AUDIT

Audit actual Login implementation.

Understand:

- initialization;
- session check;
- email validation;
- password validation;
- submit flow;
- password visibility;
- loading;
- double-submit protection;
- inline errors;
- Google login;
- forgot password;
- register navigation;
- safe next redirect;
- mock auth;
- real auth if any;
- mobile layout;
- accessibility.

Expected state model conceptually:

INITIALIZING
READY
SUBMITTING
SUCCESS
ERROR
NETWORK_ERROR
RATE_LIMITED
UNVERIFIED_EMAIL

Verify actual states.

Record:

Implemented:
[...]

Mock:
[...]

Missing:
[...]

Security concerns:
[...]

---

# 18. SAFE REDIRECT MODEL

Audit Login redirect logic.

Important expected rule:

?next=

must NOT allow arbitrary external redirect.

Check:

- safe internal allowlist;
- relative path handling;
- query propagation;
- meeting invite preservation.

Potential attack:

?next=https://evil.example

must not be blindly accepted.

Verify source only.

---

# 19. DASHBOARD AUDIT

Audit actual Home/Dashboard.

Understand:

- session gate;
- profile;
- hero;
- create CTA;
- join CTA;
- upcoming meetings;
- active meeting;
- recent meetings;
- notifications;
- profile menu;
- logout;
- loading;
- empty state;
- partial error;
- offline;
- mobile behavior.

Expected Dashboard role:

authenticated application hub

not merely marketing landing page.

Verify actual source.

---

# 20. DASHBOARD DATA CONTRACT

Extract actual mock/service contract if present.

Expected conceptual data:

user
upcomingMeetings
recentMeetings
notifications
unreadNotifications

Meeting card may conceptually require:

id
roomCode
title
status
startAt
endAt
hostName
participantCount

BUT source decides.

Record actual contract.

Do not invent missing fields.

---

# 21. CREATE MEETING DOMAIN

Audit current or planned source.

Understand whether UI supports:

title
waiting room
max participants
microphone policy
camera policy
screen sharing
chat
reactions
raise hand
participant invites
recording

Classify each separately.

Expected action flow:

Dashboard
→ Create Meeting
→ Configure
→ Confirm/Create
→ Pre-Join or Meeting start

Verify source.

---

# 22. ROOM CODE MODEL

Trace how room code is currently represented.

Audit:

- generation;
- validation;
- format;
- uniqueness;
- URL handling;
- display;
- copy/share.

Critical rule:

Room code is an identifier.

Room code should NOT be treated as the only authorization secret.

If source currently does otherwise, report.

---

# 23. JOIN MEETING DOMAIN

Audit:

- room code input;
- meeting URL input;
- validation;
- loading;
- not found;
- ended;
- locked;
- full;
- blocked;
- authentication requirement;
- redirect to prejoin.

Expected flow:

Join
→ Resolve Meeting
→ Validate State
→ Pre-Join

Not:

Join
→ directly publish media.

Verify actual.

---

# 24. PRE-JOIN DOMAIN

Audit actual implementation.

Understand:

- local camera preview;
- mic preview;
- camera toggle;
- mic toggle;
- device selector;
- display name;
- speaker selector where supported;
- permission denial;
- device missing;
- join action.

Critical:

Pre-Join local preview
≠
publishing media to room.

Verify whether media remains local.

---

# 25. BROWSER MEDIA PERMISSIONS

Audit use of:

navigator.mediaDevices.getUserMedia
navigator.mediaDevices.enumerateDevices
navigator.mediaDevices.getDisplayMedia

Understand permission flow.

Record handling for:

NotAllowedError
NotFoundError
NotReadableError
OverconstrainedError
browser unsupported

Do not assume handling exists.

---

# 26. WAITING ROOM DOMAIN

Audit actual state model.

Expected conceptual statuses may include:

waiting
approved
rejected
removed

Verify source.

Understand:

Participant:
request join
→ waiting

Host:
approve / reject

Participant:
realtime update
→ continue or stop

Record whether current UI is:

static
mock realtime
Supabase realtime
other.

---

# 27. MEETING LIFECYCLE

Build actual meeting lifecycle map.

Possible conceptual lifecycle:

scheduled
waiting
active
ended
cancelled

Verify actual source/data contract.

Do not invent lifecycle enum.

Understand transitions and actor authority.

Example:

scheduled
→ active
→ ended

Identify whether transitions exist only in UI mock.

---

# 28. PARTICIPANT LIFECYCLE

Build participant lifecycle.

Possible concepts:

invited
waiting
approved
joined
left
removed
rejected

Verify actual.

Understand distinction:

membership record
≠
current media connection
≠
presence state

This distinction is critical.

---

# 29. PARTICIPANT ROLES

Audit actual role model.

Possible roles:

host
co_host
member
viewer

Verify exact implementation.

Understand:

role display
role mutation
permission implications
host uniqueness
co-host assignment

Critical:

Client role variable
≠
authorization.

---

# 30. HOST / CO-HOST DOMAIN

Audit host controls.

Expected possible actions:

approve participant
reject participant
kick participant
assign co-host
remove co-host
lock meeting
update meeting settings
stop screen share
end meeting

Verify each.

Classify individually.

Do not write Host Controls = implemented merely because menu exists.

---

# 31. CAMERA / MICROPHONE DOMAIN

Audit media modules.

Understand:

local tracks
remote tracks
enable/disable
mute state
device switching
permission handling
reconnect
track subscription
UI sync

Determine whether current implementation is:

mock
native preview only
LiveKit-connected
partial.

---

# 32. SCREEN SHARE DOMAIN

Audit screen sharing.

Expected browser flow:

User gesture
→ getDisplayMedia / LiveKit screen share
→ browser picker
→ publish screen
→ presenter layout
→ track ended
→ restore layout

Verify actual.

Critical:

Do NOT infer screen share exists because button exists.

---

# 33. MEDIA TOPOLOGY — CRITICAL

Determine actual implementation strategy.

Allowed target architecture:

LiveKit SFU / WebRTC

Do NOT classify full-mesh P2P as acceptable for 50–100 participants.

Audit whether project:

- imports LiveKit;
- creates Room;
- requests token;
- publishes tracks;
- subscribes remote tracks;
- uses adaptiveStream;
- uses dynacast.

Record exact boundary.

---

# 34. LIVEKIT TOKEN SECURITY

Trace current token model.

Correct conceptual trust:

Browser
→ authenticated request
→ trusted server/Edge Function
→ validate meeting/member/permission
→ signed LiveKit token
→ Browser
→ LiveKit

Audit whether:

LIVEKIT_API_SECRET

appears anywhere client-side.

If yes:

CRITICAL SECURITY ISSUE.

Do not print value.

Record required rotation.

---

# 35. ACTIVE SPEAKER

Audit actual behavior.

Understand whether:

active speaker comes from:

LiveKit
mock state
manual selection
not implemented.

UI expectation may include:

main stage
speaker highlight
participant sorting.

Source decides.

---

# 36. LARGE ROOM UI

Audit whether current Meeting UI is designed for:

50–100 participants.

Important principle:

100 participants
≠
100 high-resolution video elements simultaneously.

Audit:

visible tile limit
pagination
filmstrip
virtualization
active speaker
pinned participant
offscreen subscription strategy

Record current status.

---

# 37. ADAPTIVE STREAM / DYNACAST

Audit actual LiveKit room configuration.

Verify whether:

adaptiveStream: true
dynacast: true

or equivalent exists.

Do not store expected configuration as implemented unless source confirms.

Explain current performance implication.

---

# 38. PARTICIPANT PANEL

Audit:

search
role labels
mic status
camera status
screen-share status
speaking state
host menu
pagination/virtualization
count

Check whether technical IDs leak into UI.

Human-facing UI should prefer:

display name
avatar
role label

not UUID.

---

# 39. CHAT DOMAIN

Audit actual chat implementation.

Determine:

mock
Supabase table
Supabase Realtime
LiveKit data channel
not implemented

Understand:

message contract
sender
timestamp
type
delete/edit if any
history
reconnect
spam handling.

Critical presentation security:

Never render user content via unsafe raw innerHTML.

Verify actual source.

---

# 40. REACTIONS

Audit reaction behavior.

Possible conceptual transport:

Supabase Broadcast
LiveKit data
other

Verify source.

Understand:

ephemeral
not necessarily persisted.

Do not invent storage.

---

# 41. RAISE HAND

Audit:

state
transport
ordering
host visibility
reset behavior

Classify current implementation.

---

# 42. NOTIFICATIONS

Audit Dashboard/meeting notifications.

Understand distinction:

Application notification
≠
meeting realtime state
≠
browser notification permission

Record:

notification source
persistence
unread state
UI panel
mock/real.

---

# 43. MEETING SETTINGS

Audit settings model.

Possible concepts:

waiting room
chat
screen share
camera
microphone
reactions
raise hand
invites
recording
lock room

Verify exact fields.

Determine:

who can modify
UI authority
server authority
runtime propagation

Do not invent fields.

---

# 44. LEAVE VS END MEETING

Critical distinction:

LEAVE MEETING
→ participant leaves

END MEETING
→ meeting ends for everyone

Audit source to ensure they are distinct.

Host leaving should not automatically imply end unless business rule explicitly says so.

Record actual behavior.

---

# 45. MEETING ENDED SCREEN

Audit:

reason
room code
duration
return home
join another
rejoin behavior
meeting ended vs removed vs blocked distinction.

Human-facing messages should not expose backend implementation terminology.

---

# 46. REMOVED PARTICIPANT

Audit UX/security state when host removes someone.

Potential conceptual flow:

moderation authorized
→ media participant removed
→ app participant status updated
→ token/access invalidated as appropriate
→ user sees removed state

Verify current implementation.

Do not assume.

---

# 47. RECORDING DOMAIN

Audit whether recording exists.

Distinguish:

Recording control
Recording media pipeline
Recording metadata
Recording file
Recording list

A "Bản ghi" nav item does NOT prove recording pipeline exists.

Classify carefully.

Possible state:

NOT IMPLEMENTED
SCAFFOLD
PARTIAL

Record exact boundary.

---

# 48. AUTHENTICATION MODEL

Audit actual auth.

Determine:

mock session
Supabase Auth
custom auth
no auth

Understand:

login
register
logout
session restore
OAuth
password reset
email verification
auth state changes.

Do not write Supabase Auth implemented unless actual source calls it.

---

# 49. SUPABASE CLIENT

Audit:

supabase-client.js
config.js
imports

Determine:

initialized?
used?
mock only?
production calls?

Record key type.

Public browser key may be valid conceptually.

Secret/service role must not be browser-side.

Do not print keys.

---

# 50. SUPABASE DATABASE

Audit migrations.

Important:

migration files existing
≠
database deployed.

For each migration classify:

EMPTY
PLACEHOLDER
SCAFFOLD
VALID SCHEMA
FULL IMPLEMENTATION

Extract actual tables only if defined.

Possible expected domain tables may include:

profiles
meetings
meeting_settings
meeting_participants
meeting_join_requests
messages
security_events
security_blocks

BUT source decides.

---

# 51. DATABASE RELATIONSHIPS

If schema exists, map:

PK
FK
unique constraints
indexes
timestamps
status fields
role fields

Build ER-style summary.

Do not infer relationships not declared.

---

# 52. RLS AUDIT — CRITICAL

Audit:

002_rls_policies.sql
and other migrations/policies.

Determine actual RLS coverage per table.

Record:

RLS enabled:
YES/NO

SELECT policy:
[...]

INSERT policy:
[...]

UPDATE policy:
[...]

DELETE policy:
[...]

Critical checks:

user cannot promote self to host;
user cannot approve self;
user cannot end meeting as member;
user cannot read unrelated meeting;
security table not exposed to ordinary user.

Only report what source proves.

---

# 53. EDGE FUNCTIONS

Inventory actual functions.

Possible folders:

meeting-create
meeting-join
meeting-token
meeting-waiting-action
meeting-moderate
meeting-settings
meeting-end
security-event

For each record:

Status:
SCAFFOLD / PARTIAL / IMPLEMENTED

JWT verification:
YES/NO/UNKNOWN

Authorization:
[...]

Input validation:
[...]

DB mutation:
[...]

Secrets used:
[...]

Response contract:
[...]

Do not assume every index.ts is implemented.

---

# 54. SECURITY EVENT MODEL

Audit security code/schema.

Understand whether project supports:

UNAUTHORIZED_ACTION
INVALID_TOKEN
ROLE_ESCALATION_ATTEMPT
JOIN_SPAM
CHAT_SPAM
RATE_LIMIT
BLOCKED_USER_REQUEST
INVALID_MEETING_ACCESS

These are examples only.

Store exact source values.

---

# 55. BLOCKING MODEL

Audit whether security blocking exists.

Potential scopes:

meeting
join
chat
account

Verify source.

Critical policy:

Opening DevTools
≠
malicious behavior.

Blocking should be based on server-observed abuse, not cosmetic client tampering.

Record actual design.

---

# 56. SECURITY RESPONSE PHILOSOPHY

Verify whether project follows progressive handling:

deny
→ log
→ rate limit
→ warning/challenge
→ temporary restriction
→ remove from meeting
→ stronger restriction/manual review

Do not assume.

Avoid remembering auto-permanent-ban behavior unless source explicitly defines it.

---

# 57. TURNSTILE / BOT PROTECTION

Audit whether Cloudflare Turnstile or equivalent exists.

If only VITE_TURNSTILE_SITE_KEY exists:

do NOT mark server verification implemented.

Client widget alone is not trusted validation.

Trace server-side verification if any.

---

# 58. XSS SAFETY

Search presentation code for:

innerHTML
insertAdjacentHTML
dangerous template construction

Determine whether user-controlled content can reach it.

Important user-controlled values:

display name
meeting title
chat
notification content

Prefer:

textContent

or safe DOM construction.

Report actual issues.

Do not modify.

---

# 59. OPEN REDIRECT SAFETY

Audit any:

next
returnUrl
redirect
callback

Ensure browser cannot redirect authenticated user to arbitrary external URL.

Record exact implementation.

---

# 60. CSRF / REQUEST AUTH MODEL

Understand how trusted requests are intended/authenticated.

If using Supabase Edge Functions, audit:

Authorization Bearer JWT
CORS
method validation
content-type
origin if applicable

Do not invent mitigations not present.

---

# 61. RATE LIMITING

Audit whether rate limiting exists for:

login
join
chat
meeting creation
moderation

Classify:

IMPLEMENTED
PLATFORM-PROVIDED
PLANNED
NOT IMPLEMENTED
UNKNOWN

Do not treat comment/TODO as implementation.

---

# 62. SECRET HANDLING

Search source conceptually for:

service_role
SUPABASE_SECRET
LIVEKIT_API_SECRET
database password
private key
TURNSTILE_SECRET

Never output actual values.

If potential secret is committed:

report:

SECURITY INCIDENT CANDIDATE

File:
[...]

Rotation recommended:
YES

Do not remediate in read-only task.

---

# 63. UI DESIGN SYSTEM — SOURCE AUDIT

Extract actual design system from CSS.

Do not estimate from screenshots when CSS exists.

Record:

Font
Weights
Typography
Brand colors
Neutral colors
Semantic colors
Background
Surface
Border
Radius
Shadow
Spacing
Focus
Buttons
Inputs
Cards
Dropdowns
Panels
Modals
Skeletons
Toast/alerts if any

---

# 64. FLASH MEETING BRAND SYSTEM

Expected brand direction conceptually:

Blue
Modern
Clean
Professional
Realtime collaboration

BUT source decides exact values.

Do NOT store guessed hex values.

If CSS defines:

--color-primary

record exact source value.

If multiple values conflict:

document inconsistency.

---

# 65. TYPOGRAPHY

Determine actual:

font-family
fallback
weights

Record hierarchy:

Page Title
Hero Title
Section Heading
Body
Muted Body
Form Label
Input
Button
Nav
Badge
Participant Name
Meeting Metadata

Do not infer sizes if CSS defines them.

---

# 66. SPACING / RADIUS / SHADOW

Extract recurring values.

Determine whether design follows:

4px grid
8px grid
other

Record only confirmed patterns.

For radius:

button
input
card
video tile
panel
dropdown
modal

For shadow:

card
dropdown
modal
hero visual

---

# 67. BUTTON SYSTEM

Audit actual variants.

Possible:

Primary
Secondary
Danger
Ghost
Icon
Disabled
Loading

Record:

height
padding
radius
background
text
border
hover
focus
disabled

Do not invent variants.

---

# 68. FORM SYSTEM

Audit:

label
input
password field
validation message
helper
focus
disabled
loading
select
checkbox
textarea

Record Login as reference if currently most complete.

---

# 69. MODAL POLICY

Determine actual modal architecture.

For FLASH MEETING, likely meaningful modal uses may include:

destructive action
end meeting confirmation
remove participant confirmation
security warning
high-impact settings

Do not automatically use modal for:

loading
ordinary navigation
simple validation

Verify source patterns.

---

# 70. DROPDOWN / POPOVER SYSTEM

Audit:

profile menu
notification panel
participant action menu

Understand:

open
toggle
outside click
ESC
keyboard
focus management
aria-expanded

Record common pattern.

---

# 71. MEETING TOOLBAR DESIGN

Audit actual toolbar.

Potential controls:

mic
camera
share
chat
participants
reaction
more
leave

Verify exact.

Record:

icon style
active/inactive
danger leave action
tooltip
keyboard
mobile behavior.

---

# 72. VIDEO TILE DESIGN

Audit participant tile.

Record:

aspect ratio
name overlay
mic indicator
camera-off state
speaking state
host badge
screen-share badge
avatar fallback
hover actions

Do not infer functionality solely from CSS.

---

# 73. MAIN STAGE DESIGN

Audit:

active speaker view
screen share view
pinned participant
filmstrip
grid transitions

Record source behavior.

---

# 74. SIDE PANEL SYSTEM

Audit panels:

participants
chat
meeting info
settings if any

Understand:

desktop width
mobile drawer
close behavior
mutual exclusivity
scrolling
sticky header/footer

---

# 75. RESPONSIVE PHILOSOPHY

Audit actual breakpoints.

Important target classes:

Desktop
Laptop
Tablet
Mobile

Typical review sizes may include:

1440
1280
1024
768
430
390
375

But source determines breakpoints.

Record actual CSS media queries.

---

# 76. MOBILE MEETING UX

Audit whether mobile Meeting is intentionally redesigned.

Expected concept:

main stage
participant strip
bottom controls
panels as drawer

Do NOT classify desktop shrink as proper mobile support unless source is usable.

---

# 77. ACCESSIBILITY AUDIT

Audit:

semantic HTML
labels
button usage
keyboard
focus
aria-label
aria-expanded
aria-haspopup
aria-live
heading hierarchy
contrast
touch target

Record current strengths/gaps.

Do not assume accessibility from visual design.

---

# 78. LOADING UX

Audit actual loading patterns.

Possible:

skeleton
spinner
button spinner
page initialization
reconnect state

Record canonical behavior.

Avoid interpreting mock delay as real network logic.

---

# 79. ERROR UX

Audit:

inline field error
page error
section retry
network banner
media permission error
meeting state error
security restriction

Record error-code mapping if implemented.

Avoid raw backend exception in user-facing UI.

Verify source.

---

# 80. EMPTY STATES

Audit:

no upcoming meetings
no recent meetings
no notifications
no chat messages
no participants search result
no recordings

Record actual language and component style.

---

# 81. HUMAN-FACING LANGUAGE

FLASH MEETING UI should avoid developer terminology.

Audit for terms such as:

backend
RLS
Edge Function
Supabase Auth
LiveKit token
JWT
SFU
WebRTC internal
database
raw enum
UUID

These belong in engineering tooling, not ordinary user UI.

Record violations.

---

# 82. REAL DATA VS MOCK DATA

Critical distinction.

Audit each page for:

hard-coded design sample
mock service
static placeholder
real API/data

Screenshot-like names/data are not business rules.

Examples such as:

Nguyễn Hải Nam
ABC-123-XYZ
86 người
14:00

may be demo data only.

Do not store as canonical product data.

---

# 83. MOCK ARCHITECTURE

Audit current frontend-first mock architecture.

Identify:

mock auth
mock dashboard
mock meeting
mock participants
mock notifications
mock chat

Determine whether UI is decoupled from data source.

Preferred conceptual structure:

UI
→ Service Contract
→ Mock Adapter now
→ Supabase Adapter later

Verify actual source.

Record whether migration to real backend will require UI rewrite.

---

# 84. DATA CONTRACT EXTRACTION

Extract actual frontend contracts.

Potential entities:

User
Meeting
MeetingSettings
Participant
JoinRequest
Message
Notification
SecurityResponse

For each source-confirmed contract record:

fields
types where inferable from code
status values
optional fields
consumer modules

Do not invent database fields.

---

# 85. SERVICE CONTRACT EXTRACTION

Audit functions such as:

login()
logout()
loadDashboard()
createMeeting()
resolveMeeting()
joinMeeting()
loadParticipants()
sendMessage()

Record actual input/output contracts.

Classify:

mock
real
partial.

---

# 86. STATE MANAGEMENT

Understand current approach.

Possible:

module-local state
single object state
DOM state
URL state
localStorage
sessionStorage

Record actual architecture.

Check for:

global mutable window state
duplicate state
state/UI drift

Do not refactor.

---

# 87. LOCAL STORAGE / SESSION STORAGE

Audit what is stored.

Critical:

Never store:

password
secret
LiveKit API secret

Determine whether mock session uses local/session storage.

Record whether persistence is development-only.

---

# 88. BROWSER URL STATE

Audit:

room query
next query
mock query
page navigation

Record allowed parameters.

Identify whether query strings drive mock scenarios.

Mock controls must not become security controls.

---

# 89. MEDIA PERFORMANCE MODEL

For 50–100 users, audit source against:

SFU
selective subscriptions
adaptive stream
dynacast
limited visible tiles
pagination/filmstrip
virtual participant list

Record current readiness:

READY
PARTIAL
NOT IMPLEMENTED

Do not claim 100-user support from UI alone.

---

# 90. NETWORK / RECONNECT MODEL

Audit:

LiveKit reconnect
Supabase realtime reconnect
offline banner
session refresh
page recovery

Classify each separately.

---

# 91. PERFORMANCE FRONTEND

Audit:

page-specific module loading
bundle imports
LiveKit loaded on Dashboard?
duplicate CSS
large images
base64 assets
render loops
event listeners
DOM scale

Critical principle:

Dashboard/Login should not load meeting media stack unnecessarily.

Verify actual.

---

# 92. ASSET AUDIT

Audit:

assets/logo
assets/icons
assets/images

Determine:

branding consistency
unused images
large files
remote URLs
base64
placeholder screenshot assets

Do not delete.

Record candidates.

---

# 93. GITHUB REPOSITORY HYGIENE

Audit:

.gitignore
dist
node_modules
.env
temporary files
duplicate artifacts

Do not cleanup.

Only report.

---

# 94. TESTING ARCHITECTURE

Audit actual tests.

Possible:

unit
integration
UI
E2E
security
load

Do not assume test system exists.

Record:

test framework
scripts
coverage area
gaps.

A feature is not fully verified merely because source compiles.

---

# 95. LOGIN TEST KNOWLEDGE

Record whether current Login has tests for:

empty fields
invalid email
invalid credentials
loading
double submit
safe next
password toggle
session restore
mobile
keyboard

Only source/test evidence counts.

---

# 96. DASHBOARD TEST KNOWLEDGE

Record whether tests cover:

valid session
invalid session
empty dashboard
active meeting
upcoming
recent
partial error
offline
dropdown
logout
navigation

---

# 97. SECURITY TEST KNOWLEDGE

Audit whether tests attempt:

member end meeting
member self-promote
member approve self
blocked user token
removed user rejoin
invalid JWT
RLS cross-meeting read
XSS
open redirect
spam/rate limit

Record actual.

---

# 98. LOAD TEST KNOWLEDGE

Audit whether project has any real 50–100 participant load test.

Do not equate:

100 mock cards

with:

100 WebRTC participants.

Record actual load-test evidence.

---

# 99. PRODUCTION READINESS MODEL

Assess separately:

Frontend readiness
Backend readiness
Database readiness
Auth readiness
Realtime readiness
Media readiness
Security readiness
Deployment readiness
Monitoring readiness
Load readiness

Use:

READY
PARTIAL
NOT READY
UNKNOWN

Provide evidence.

---

# 100. CURRENT DEVELOPMENT LIMITATIONS

Create a source-backed list.

Examples of categories:

mock-only auth
backend scaffold only
LiveKit not connected
screen share UI only
recording nav only
no RLS tests
no load test
GitHub Pages path issue

Only include actual findings.

---

# 101. DOCUMENTATION CONFLICTS

If documentation says A but source says B:

report:

DOCUMENTATION CONFLICT

Document:
[...]

Document says:
[...]

Current source:
[...]

Current implementation decision:
[...]

Recommended future action:
Update documentation / investigate / no action

Do not modify docs in this task.

---

# 102. MEMORY CONFIDENCE LEVEL

Classify important knowledge internally as:

CONFIRMED BY SOURCE

CONFIRMED BY TEST

DESIGN DECISION

CURRENT LIMITATION

SCAFFOLD ONLY

MOCK ONLY

INFERENCE — DO NOT STORE AS FACT

Only strong facts should become long-term project knowledge.

---

# 103. WHAT NOT TO STORE LONG TERM

Do NOT store volatile details such as:

runtime PID
temporary dev server port unless architecture-level
temporary mock meeting count
current notification count
specific demo user
specific demo room code
temporary error
temporary screenshot names
current Git dirty count
one-off timestamps

Do not store secrets.

---

# 104. WHAT SHOULD BE STORED LONG TERM

Store stable verified knowledge:

project purpose
project root
frontend architecture
page inventory
module responsibility
design system
navigation flow
meeting lifecycle
participant lifecycle
role model
mock architecture
data contracts
Supabase architecture status
RLS philosophy
Edge Function boundaries
LiveKit architecture status
security trust boundary
deployment architecture
responsive philosophy
performance rules
testing philosophy
known stable limitations

---

# 105. FLASH MEETING DESIGN SYSTEM MEMORY FORMAT

Create/update project knowledge section:

FLASH MEETING DESIGN SYSTEM

Brand:
[...]

Font:
[...]

Weights:
[...]

Typography:
[...]

Primary:
[...]

Primary Hover:
[...]

Primary Soft:
[...]

Background:
[...]

Surface:
[...]

Text:
[...]

Muted:
[...]

Border:
[...]

Success:
[...]

Info:
[...]

Warning:
[...]

Danger:
[...]

Radius:
[...]

Spacing:
[...]

Shadow:
[...]

Buttons:
[...]

Inputs:
[...]

Cards:
[...]

Dropdowns:
[...]

Panels:
[...]

Modals:
[...]

Skeleton:
[...]

Meeting Toolbar:
[...]

Video Tiles:
[...]

Responsive:
[...]

Accessibility:
[...]

Only confirmed source values.

---

# 106. FLASH MEETING ARCHITECTURE MEMORY FORMAT

FLASH MEETING ARCHITECTURE

Project root:
[...]

Frontend:
[...]

Build:
[...]

Hosting:
[...]

Auth:
[...]

Database:
[...]

Realtime:
[...]

Storage:
[...]

Trusted backend:
[...]

Media:
[...]

Media topology:
[...]

Security boundary:
[...]

Deployment:
[...]

Testing:
[...]

Current phase:
[...]

---

# 107. FLASH MEETING UX RULES MEMORY FORMAT

FLASH MEETING UX RULES

Authentication:
[...]

Dashboard:
[...]

Create Meeting:
[...]

Join Meeting:
[...]

Pre-Join:
[...]

Waiting Room:
[...]

Meeting Room:
[...]

Participants:
[...]

Chat:
[...]

Screen Share:
[...]

Host Controls:
[...]

Leave:
[...]

End Meeting:
[...]

Notifications:
[...]

Loading:
[...]

Errors:
[...]

Empty States:
[...]

Responsive:
[...]

Accessibility:
[...]

---

# 108. FLASH MEETING DOMAIN MEMORY FORMAT

FLASH MEETING DOMAIN

User:
[...]

Profile:
[...]

Meeting:
[...]

Meeting Settings:
[...]

Participant:
[...]

Participant Role:
[...]

Participant Lifecycle:
[...]

Join Request:
[...]

Message:
[...]

Notification:
[...]

Security Event:
[...]

Security Block:
[...]

Recording:
[...]

Media Session:
[...]

---

# 109. FLASH MEETING SECURITY MEMORY FORMAT

FLASH MEETING SECURITY

Browser trust:
[...]

Authentication:
[...]

Authorization:
[...]

RLS:
[...]

Edge Functions:
[...]

LiveKit token:
[...]

Secrets:
[...]

Open redirect:
[...]

XSS:
[...]

Rate limiting:
[...]

Abuse handling:
[...]

Temporary blocking:
[...]

Meeting removal:
[...]

Bot protection:
[...]

Known gaps:
[...]

---

# 110. FLASH MEETING PERFORMANCE MEMORY FORMAT

FLASH MEETING PERFORMANCE

Target room size:
[...]

Visible video strategy:
[...]

SFU:
[...]

adaptiveStream:
[...]

dynacast:
[...]

Screen share priority:
[...]

Active speaker:
[...]

Participant virtualization:
[...]

Page-specific bundles:
[...]

Dashboard media dependency:
[...]

Mobile strategy:
[...]

Load testing:
[...]

---

# 111. FRONTEND-FIRST WORKFLOW MEMORY

Verify and record current development rule.

Expected project rule:

When user names a screen:

1. analyze business purpose;
2. identify actor;
3. identify entry/exit flow;
4. define data;
5. define UI components;
6. define actions;
7. define permissions;
8. define validation;
9. define loading/error/empty;
10. define edge cases;
11. define responsive behavior;
12. define security implications;
13. define future Supabase contract;
14. define future LiveKit contract where relevant;
15. then implement UI;
16. use mock service/data;
17. review;
18. only after all UI is stabilized, implement backend.

Verify whether current source/workflow follows this.

---

# 112. KNOWN NON-NEGOTIABLE PRINCIPLES

Verify and remember where source/design supports:

- FLASH MEETING uses clean modern meeting-product UI.
- Frontend is not a security authority.
- Secrets never belong in GitHub Pages/browser.
- Role display is not authorization.
- Sensitive actions must be server-authorized.
- Supabase RLS is part of database protection.
- Edge Functions are trusted server logic where used.
- LiveKit secret must remain server-side.
- Meeting media must not be sent through Supabase Realtime.
- 50–100 participant target requires SFU architecture.
- Full WebRTC mesh is not the target.
- Room code is an identifier, not sufficient security.
- Login must support safe return-to-meeting flow.
- Pre-Join local preview is separate from publishing media.
- Leave Meeting and End Meeting are different operations.
- User-generated content must render safely.
- Backend technology names should not appear in ordinary user UI.
- Mock data is not production data.
- UI-first implementation must preserve future service contracts.
- Source of truth remains current code.

Only store after confirmation.

---

# 113. CROSS-PROJECT REUSABLE DESIGN LANGUAGE

Create a generic reusable design summary if source supports it:

MODERN REALTIME COLLABORATION DESIGN SYSTEM

Principles:

- clean light canvas;
- strong but restrained blue brand accent;
- high legibility;
- large video-first surfaces;
- subtle borders/shadows;
- clear primary action;
- semantic status colors;
- accessible controls;
- compact meeting toolbar;
- participant tiles;
- responsive side panels;
- mobile drawers;
- skeleton loading;
- inline errors;
- destructive confirmation only where meaningful;
- server-authoritative security;
- visible network/reconnect feedback.

Do not copy FLASH MEETING logo/product-specific wording into generic section.

---

# 114. UPDATE PROJECT KNOWLEDGE — DO NOT JUST WRITE REPORT

If persistent/project memory is available:

UPDATE IT.

Merge with existing FLASH MEETING knowledge.

Do not duplicate conflicting entries.

Replace outdated information only when source proves it obsolete.

Do not store secrets or volatile values.

If project memory is not available:

output complete proposed knowledge content.

Do NOT automatically create:

docs/AI_PROJECT_MEMORY.md

unless user explicitly allows source modification.

This task remains read-only.

---

# 115. CONFLICT RESOLUTION

If prior knowledge says A
but current source says B:

report:

MEMORY CONFLICT

Previous:
A

Current Source:
B

Decision:
B replaces A

Reason:
[...]

If source is ambiguous:

do NOT replace.

Mark:

UNRESOLVED.

---

# 116. INCOMPLETE FEATURE HANDLING

If feature is partial:

write:

PARTIAL

Example format:

Screen Share:
PARTIAL — UI and state exist, but no LiveKit publish path found.

Do not say:

IMPLEMENTED

unless source meaningfully supports complete flow.

---

# 117. SCAFFOLD HANDLING

If files exist but contain placeholder/TODO:

write:

SCAFFOLD

Example:

Supabase Edge Functions:
SCAFFOLD — function folders and index.ts exist, but trusted business logic is not implemented.

This distinction is mandatory.

---

# 118. MOCK HANDLING

If frontend simulates success/error/data:

write:

MOCK

Example:

Dashboard:
MOCK — full UI states exist using dashboard-service mock data; no Supabase queries found.

Mock is valuable frontend implementation.

Do not label it fake or useless.

But do not call it backend complete.

---

# 119. DO NOT CODE

This entire task is:

READ
ANALYZE
VERIFY
CLASSIFY
SUMMARIZE
UPDATE PROJECT KNOWLEDGE

Do not:

modify HTML
modify CSS
modify JS
modify TypeScript
modify SQL
modify migrations
modify RLS
modify Edge Functions
modify Vite
modify workflow
modify package files
install dependencies
run deploy
run migration
run database mutation
commit
push

unless explicitly asked in a later task.

---

# 120. FINAL REPORT REQUIRED

Return exactly a structured report:

FLASH MEETING — DEEP PROJECT KNOWLEDGE & MEMORY UPDATE RESULT

---

PROJECT

Root:
[...]

Project purpose:
[...]

Current development phase:
[...]

Architecture summary:
[...]

Current page count:
[...]

Current major modules:
[...]

---

IMPLEMENTATION STATUS

Frontend:
[...]

Login:
[...]

Dashboard:
[...]

Create Meeting:
[...]

Join Meeting:
[...]

Pre-Join:
[...]

Waiting Room:
[...]

Meeting Room:
[...]

Participants:
[...]

Chat:
[...]

Screen Share:
[...]

Host Controls:
[...]

Notifications:
[...]

Recording:
[...]

Supabase:
[...]

RLS:
[...]

Edge Functions:
[...]

LiveKit:
[...]

GitHub Pages:
[...]

---

DESIGN SYSTEM

Brand:
[...]

Font:
[...]

Font weights:
[...]

Typography:
[...]

Canonical color tokens:
[...]

Semantic colors:
[...]

Surfaces:
[...]

Borders:
[...]

Radius:
[...]

Spacing:
[...]

Shadows:
[...]

Buttons:
[...]

Inputs:
[...]

Cards:
[...]

Dropdowns:
[...]

Panels:
[...]

Meeting toolbar:
[...]

Video tiles:
[...]

Responsive:
[...]

Accessibility:
[...]

---

GLOBAL UX PATTERNS

Navigation:
[...]

Session initialization:
[...]

Loading:
[...]

Errors:
[...]

Empty states:
[...]

Dropdown:
[...]

Modal:
[...]

Danger actions:
[...]

Mobile:
[...]

---

MEETING DOMAIN

User:
[...]

Meeting:
[...]

Meeting settings:
[...]

Room code:
[...]

Meeting lifecycle:
[...]

Participant:
[...]

Participant lifecycle:
[...]

Roles:
[...]

Waiting room:
[...]

Host/co-host:
[...]

Leave:
[...]

End meeting:
[...]

---

MEDIA MODEL

Camera:
[...]

Microphone:
[...]

Screen Share:
[...]

LiveKit:
[...]

SFU:
[...]

Active Speaker:
[...]

Remote Tracks:
[...]

Adaptive Stream:
[...]

Dynacast:
[...]

Reconnect:
[...]

50–100 participant readiness:
[...]

---

APPLICATION DATA MODEL

Auth:
[...]

Profile:
[...]

Dashboard:
[...]

Meeting data:
[...]

Participants:
[...]

Messages:
[...]

Notifications:
[...]

Security events:
[...]

Security blocks:
[...]

Recordings:
[...]

Mock/service contracts:
[...]

---

SUPABASE

Client:
[...]

Database migrations:
[...]

Schema:
[...]

RLS:
[...]

Edge Functions:
[...]

Realtime:
[...]

Storage:
[...]

Deployment status:
[...]

---

SECURITY MODEL

Browser trust:
[...]

Authentication:
[...]

Authorization:
[...]

RLS:
[...]

Host authorization:
[...]

LiveKit token:
[...]

Secret handling:
[...]

Open redirect:
[...]

XSS:
[...]

Rate limiting:
[...]

Abuse handling:
[...]

Temporary blocks:
[...]

Bot protection:
[...]

Critical gaps:
[...]

---

DEPLOYMENT

Vite:
[...]

Multi-page build:
[...]

GitHub Actions:
[...]

GitHub Pages:
[...]

Base path:
[...]

Custom domain readiness:
[...]

HTTPS:
[...]

Production readiness:
[...]

---

PERFORMANCE

Bundle strategy:
[...]

Page-specific loading:
[...]

Meeting media bundle:
[...]

Visible tiles:
[...]

Participant virtualization:
[...]

Asset performance:
[...]

Media performance:
[...]

Load testing:
[...]

---

TESTING

Unit:
[...]

Integration:
[...]

UI:
[...]

Security:
[...]

E2E:
[...]

Load:
[...]

Current test confidence:
[...]

---

CURRENT IMPLEMENTATION LIMITATIONS

1. [...]
2. [...]
3. [...]

Only source-backed limitations.

---

DOCUMENTATION / SOURCE CONFLICTS

[...]

---

MEMORY CONFLICTS RESOLVED

[...]

---

VOLATILE DATA EXCLUDED

[...]

---

PROJECT KNOWLEDGE UPDATED

Persistent/project memory available:
YES / NO

Updated:
YES / NO

Sections updated:
[...]

If NO:

Proposed project knowledge:
[...]

---

CONFIDENCE

Confirmed by source:
[...]

Confirmed by tests:
[...]

Design decisions:
[...]

Mock-only:
[...]

Scaffold-only:
[...]

Unresolved:
[...]

---

FINAL STATUS

PROJECT UNDERSTANDING:
COMPLETE / PARTIAL

FRONTEND UNDERSTANDING:
COMPLETE / PARTIAL

DESIGN SYSTEM UNDERSTANDING:
COMPLETE / PARTIAL

MEETING DOMAIN UNDERSTANDING:
COMPLETE / PARTIAL

SUPABASE UNDERSTANDING:
COMPLETE / PARTIAL

LIVEKIT UNDERSTANDING:
COMPLETE / PARTIAL

SECURITY UNDERSTANDING:
COMPLETE / PARTIAL

DEPLOYMENT UNDERSTANDING:
COMPLETE / PARTIAL

PROJECT KNOWLEDGE UPDATE:
COMPLETE / NOT AVAILABLE / NEEDS APPROVAL

Remaining information requiring clarification:
[...]

Then STOP.

---

# 121. FINAL PRINCIPLE

The purpose of this task is NOT to make FLASH MEETING look complete.

The purpose is to know EXACTLY what FLASH MEETING currently is.

Never convert:

planned
→ implemented

Never convert:

scaffold
→ backend complete

Never convert:

mock
→ production

Never convert:

button
→ working feature

Never convert:

dependency
→ integrated system

Never convert:

screenshot
→ business rule

Always prefer:

SOURCE EVIDENCE
+
CLEAR STATUS
+
HONEST LIMITATIONS
+
STABLE PROJECT KNOWLEDGE

over optimistic assumptions.

FLASH MEETING must become easy for future AI/Developers to understand without re-reading the entire project every task.

After completing the report and knowledge update:

STOP.
