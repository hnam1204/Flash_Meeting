# FLASH MEETING
## AI IMPLEMENTATION / CODING / DEPLOYMENT SPECIFICATION

> **Mục tiêu của file này:** AI/Codex/Developer chỉ cần đọc file này để hiểu kiến trúc, cấu trúc source, database, bảo mật, luồng người dùng, quy tắc code, cách debug và cách deploy dự án **FLASH MEETING**.
>
> **Ưu tiên:** đơn giản → rõ file → code sạch → dễ debug → dễ nâng cấp → hiệu năng cao → bảo mật server-side → deploy nhanh.

---

# 1. TỔNG QUAN DỰ ÁN

**Tên sản phẩm:** FLASH MEETING  
**Loại sản phẩm:** Web họp trực tuyến realtime tương tự Google Meet  
**Frontend:** HTML5 + CSS3 + Vanilla JavaScript ES Modules  
**Build tool:** Vite  
**Hosting website:** GitHub Pages  
**Backend / Database:** Supabase  
**Authentication:** Supabase Auth  
**Realtime application data:** Supabase Realtime  
**Storage:** Supabase Storage  
**Server-side API:** Supabase Edge Functions  
**Media Server:** LiveKit SFU  
**Media:** WebRTC  
**Quy mô V1:** tối đa 50 người / phòng họp  
**Thiết bị:** Desktop + Laptop + Mobile browser  
**Trình duyệt ưu tiên:** Chrome, Edge, Safari, Firefox phiên bản hiện đại

---

# 2. MỤC TIÊU SẢN PHẨM

FLASH MEETING phải cho phép người dùng:

1. Đăng ký / đăng nhập.
2. Tạo cuộc họp.
3. Chia sẻ link hoặc mã cuộc họp.
4. Tham gia bằng link hoặc mã phòng.
5. Kiểm tra camera / micro trước khi vào.
6. Vào phòng chờ nếu Host bật Waiting Room.
7. Host duyệt hoặc từ chối người tham gia.
8. Họp realtime bằng camera + micro.
9. Chia sẻ màn hình.
10. Chat realtime.
11. Xem danh sách thành viên.
12. Giơ tay.
13. Gửi reaction.
14. Ghim người nói / xem Active Speaker.
15. Host / Co-host quản lý phòng.
16. Rời cuộc họp.
17. Host kết thúc cuộc họp cho tất cả.
18. Lưu metadata/lịch sử cuộc họp nếu được cấu hình.

---

# 3. KIẾN TRÚC CHỐT

```text
                        USER BROWSER
                             |
                             v
                     GITHUB PAGES
                HTML + CSS + JavaScript
                             |
             +---------------+---------------+
             |                               |
             v                               v
         SUPABASE                         LIVEKIT
             |                               |
     Auth / PostgreSQL                    WebRTC
     Realtime / Storage                     SFU
     RLS / Edge Functions                 Camera
     Security / Presence                  Micro
                                         Screen
```

## GitHub Pages chịu trách nhiệm

```text
UI
HTML
CSS
JavaScript
Routing đơn giản
Client state
Hiển thị camera/video
Gọi Supabase
Kết nối LiveKit bằng token hợp lệ
```

## Supabase chịu trách nhiệm

```text
Auth
Profiles
Meetings
Meeting settings
Participants
Waiting room
Chat
Realtime application events
Storage
Security events
Temporary blocks
RLS
Edge Functions
Authorization
```

## LiveKit chịu trách nhiệm

```text
Camera
Microphone
Screen share
WebRTC
SFU
Active speaker
Media track
Adaptive stream
Dynacast
Participant media permissions
```

> **Không gửi camera, microphone hoặc frame màn hình qua Supabase Realtime.**

---

# 4. NGUYÊN TẮC QUAN TRỌNG NHẤT

## 4.1 Frontend luôn được xem là không đáng tin cậy

Người dùng có thể:

```text
mở DevTools
đọc JavaScript
sửa JavaScript
ẩn/hiện button
thay đổi biến client
gọi API trực tiếp
```

Điều này là bình thường.

Không đặt bảo mật thật ở frontend.

Ví dụ:

```javascript
if (currentUser.role === 'host') {
  showHostControls();
}
```

Đoạn trên chỉ dùng để hiển thị giao diện.

Quyền thật phải kiểm tra lại ở Supabase Edge Function / PostgreSQL RLS.

---

## 4.2 Không đưa secret vào browser

Frontend chỉ được chứa:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
LIVEKIT_URL
TURNSTILE_SITE_KEY (nếu dùng)
```

Frontend tuyệt đối không chứa:

```text
SUPABASE_SECRET_KEY
service_role
LIVEKIT_API_SECRET
LIVEKIT_API_KEY nếu dùng như secret credential
DATABASE_PASSWORD
TURNSTILE_SECRET_KEY
ADMIN_MASTER_TOKEN
```

---

# 5. CẤU TRÚC PROJECT — ĐƠN GIẢN, NHÌN TÊN BIẾT CHỨC NĂNG

```text
flash-meeting/
│
├── index.html
├── login.html
├── register.html
├── create-meeting.html
├── join-meeting.html
├── prejoin.html
├── waiting-room.html
├── meeting.html
├── meeting-ended.html
├── 404.html
│
├── css/
│   ├── base.css
│   ├── auth.css
│   ├── home.css
│   ├── meeting-form.css
│   ├── prejoin.css
│   └── meeting.css
│
├── js/
│   ├── config.js
│   ├── supabase-client.js
│   ├── auth.js
│   ├── meeting-create.js
│   ├── meeting-join.js
│   ├── meeting-prejoin.js
│   ├── meeting-waiting-room.js
│   ├── meeting-room.js
│   ├── meeting-media.js
│   ├── meeting-screen-share.js
│   ├── meeting-participants.js
│   ├── meeting-chat.js
│   ├── meeting-host-controls.js
│   ├── meeting-security.js
│   ├── livekit-client.js
│   └── utils.js
│
├── assets/
│   ├── logo/
│   ├── icons/
│   └── images/
│
├── supabase/
│   ├── migrations/
│   │   ├── 001_database_schema.sql
│   │   ├── 002_rls_policies.sql
│   │   └── 003_security_schema.sql
│   │
│   └── functions/
│       ├── meeting-create/
│       │   └── index.ts
│       ├── meeting-join/
│       │   └── index.ts
│       ├── meeting-token/
│       │   └── index.ts
│       ├── meeting-waiting-action/
│       │   └── index.ts
│       ├── meeting-moderate/
│       │   └── index.ts
│       ├── meeting-settings/
│       │   └── index.ts
│       ├── meeting-end/
│       │   └── index.ts
│       └── security-event/
│           └── index.ts
│
├── .github/
│   └── workflows/
│       └── deploy-pages.yml
│
├── .env.example
├── .gitignore
├── package.json
├── vite.config.js
└── README.md
```

---

# 6. QUY TẮC ĐẶT FILE

Tên file phải mô tả đúng chức năng.

Ví dụ:

```text
meeting-chat.js
→ chỉ xử lý chat

meeting-media.js
→ camera + microphone

meeting-screen-share.js
→ chia sẻ màn hình

meeting-host-controls.js
→ chức năng Host / Co-host

meeting-participants.js
→ danh sách và trạng thái thành viên

meeting-security.js
→ xử lý response security ở client

meeting-token
→ Edge Function tạo LiveKit token
```

## Không được tạo file kiểu

```text
helper2.js
test-final.js
new-code.js
temp.js
code.js
script.js
script2.js
final.js
final-final.js
```

Không tạo file không biết chức năng khi chỉ nhìn tên.

---

# 7. QUY TẮC KÍCH THƯỚC FILE

Không bắt buộc tuyệt đối, nhưng nên giữ:

```text
JS module:
~100–350 dòng

CSS:
~150–500 dòng

Edge Function:
~100–300 dòng
```

Nếu file vượt quá ~500–700 dòng và chứa nhiều trách nhiệm:

```text
TÁCH THEO CHỨC NĂNG
```

Không tách file chỉ vì muốn có nhiều file.

Mục tiêu:

```text
ít file
rõ chức năng
ít coupling
dễ search
dễ debug
```

---

# 8. LUỒNG NGƯỜI DÙNG CHUẨN

```text
LOGIN / REGISTER
       |
       v
HOME
       |
       +-------------------+
       |                   |
       v                   v
CREATE MEETING        JOIN MEETING
       |                   |
       +---------+---------+
                 |
                 v
              PREJOIN
                 |
                 v
        WAITING ROOM
          (nếu bật)
                 |
          HOST APPROVE
                 |
                 v
            MEETING ROOM
                 |
      +----------+----------+
      |          |          |
    CAMERA      CHAT     SHARE SCREEN
      |
      v
 PARTICIPANTS / HOST CONTROL
                 |
                 v
             LEAVE / END
                 |
                 v
           MEETING ENDED
```

---

# 9. CÁC MÀN HÌNH

## 9.1 `index.html`

Trang chủ.

Chức năng:

```text
Logo FLASH MEETING
Create Meeting
Join Meeting
Login/Profile
Recent meetings (future)
```

---

## 9.2 `login.html`

```text
Email
Password
Login
Google Login
Forgot Password
Register
```

Authentication dùng Supabase Auth.

---

## 9.3 `register.html`

```text
Display Name
Email
Password
Confirm Password
Create Account
```

Không tự lưu password vào database.

---

## 9.4 `create-meeting.html`

Cho phép Host cấu hình:

```text
Meeting title
Waiting room
Max participants
Allow microphone
Allow camera
Allow screen sharing
Allow chat
Allow reactions
Allow raise hand
```

Mặc định:

```text
maxParticipants = 50
waitingRoom = true
chat = true
camera = true
microphone = true
screenShare = true
```

---

## 9.5 `join-meeting.html`

Cho phép:

```text
Room code
Meeting URL
```

Validate meeting tồn tại trước khi chuyển tiếp.

---

## 9.6 `prejoin.html`

Chức năng:

```text
Camera preview
Microphone toggle
Camera toggle
Camera selector
Microphone selector
Speaker selector nếu browser hỗ trợ
Display name
Join button
```

Chỉ preview local.

Không publish video vào room trước khi cần.

---

## 9.7 `waiting-room.html`

Người dùng thấy:

```text
Meeting title
Host
Waiting status
Cancel
```

Host nhận realtime request.

---

## 9.8 `meeting.html`

Đây là màn hình chính.

Phải có:

```text
Meeting header
Main video stage
Video grid
Screen share stage
Toolbar
Participants panel
Chat panel
Host controls
Meeting information
Network/reconnect state
```

Không reload page khi thao tác trong meeting.

---

## 9.9 `meeting-ended.html`

Hiển thị:

```text
You left / Meeting ended
Meeting title
Room code
Duration
Back to home
Join another meeting
```

---

# 10. DATABASE SUPABASE

## 10.1 `profiles`

```sql
profiles
------------------------------
id uuid primary key
display_name text not null
avatar_url text
created_at timestamptz
updated_at timestamptz
```

`id` liên kết với Supabase Auth user.

---

## 10.2 `meetings`

```sql
meetings
------------------------------
id uuid primary key
room_code text unique not null
title text not null
host_id uuid not null
status text not null
max_participants integer default 50
locked boolean default false
started_at timestamptz
ended_at timestamptz
created_at timestamptz
updated_at timestamptz
```

Status:

```text
scheduled
waiting
active
ended
cancelled
```

---

## 10.3 `meeting_settings`

```sql
meeting_settings
------------------------------
meeting_id uuid primary key
waiting_room_enabled boolean
allow_chat boolean
allow_screen_share boolean
allow_camera boolean
allow_microphone boolean
allow_reactions boolean
allow_raise_hand boolean
allow_participant_invites boolean
recording_enabled boolean
updated_at timestamptz
```

---

## 10.4 `meeting_participants`

```sql
meeting_participants
------------------------------
id uuid primary key
meeting_id uuid not null
user_id uuid not null
role text not null
join_status text not null
joined_at timestamptz
left_at timestamptz
removed_at timestamptz
removed_by uuid
created_at timestamptz
```

Unique:

```text
meeting_id + user_id
```

Role:

```text
host
co_host
member
viewer
```

Status:

```text
waiting
approved
joined
left
removed
rejected
```

---

## 10.5 `meeting_join_requests`

```sql
meeting_join_requests
------------------------------
id uuid primary key
meeting_id uuid not null
user_id uuid not null
status text not null
requested_at timestamptz
responded_at timestamptz
responded_by uuid
```

---

## 10.6 `messages`

```sql
messages
------------------------------
id uuid primary key
meeting_id uuid not null
sender_id uuid not null
message_type text default 'text'
content text
created_at timestamptz
edited_at timestamptz
deleted_at timestamptz
```

Không render `content` bằng raw `innerHTML`.

---

## 10.7 `security_events`

```sql
security_events
------------------------------
id uuid primary key
user_id uuid
meeting_id uuid
event_type text not null
severity text not null
request_id text
metadata jsonb
created_at timestamptz
```

Ví dụ:

```text
UNAUTHORIZED_ACTION
INVALID_TOKEN
ROLE_ESCALATION_ATTEMPT
JOIN_SPAM
CHAT_SPAM
RATE_LIMIT
BLOCKED_USER_REQUEST
INVALID_MEETING_ACCESS
```

---

## 10.8 `security_blocks`

```sql
security_blocks
------------------------------
id uuid primary key
user_id uuid
meeting_id uuid
block_scope text
reason_code text
starts_at timestamptz
expires_at timestamptz
created_at timestamptz
```

Scope:

```text
meeting
join
chat
account
```

---

# 11. RLS — BẮT BUỘC

Bật Row Level Security cho tất cả application tables được expose.

## Quy tắc

### Profiles

User:

```text
READ profile được phép
UPDATE chỉ profile chính mình
```

### Meetings

Member không được tự:

```text
đổi host
end meeting
unlock room
đổi max participant
```

### Participants

User không được:

```text
tự đổi role thành host
tự approve bản thân
xóa removed_at
kick người khác
```

### Messages

Chỉ member hợp lệ của meeting mới đọc chat.

Khi INSERT:

```text
sender_id == auth.uid()
```

### Security tables

Client bình thường:

```text
NO DIRECT WRITE
NO DIRECT READ
```

---

# 12. EDGE FUNCTIONS — SERVER AUTHORITY

Các hành động nhạy cảm phải đi qua Edge Functions.

## `meeting-create`

Làm:

```text
verify JWT
validate input
create meeting
create settings
create host participant
return room code
```

---

## `meeting-join`

Làm:

```text
verify JWT
check meeting
check block
check meeting status
check max participants
check waiting room
create/update participant
```

---

## `meeting-token`

Làm:

```text
verify Supabase user
check meeting
check participant
check waiting approval
check block
check removed status
resolve real role
resolve room permissions
generate LiveKit token
return token
```

Frontend không tự tạo token.

---

## `meeting-waiting-action`

Host/Co-host:

```text
approve
reject
```

Server phải xác minh role thật từ database.

---

## `meeting-moderate`

Các action:

```text
kick
mute permission
stop screen share
assign co-host
remove co-host
```

Không tin role gửi từ browser.

---

## `meeting-settings`

Host update:

```text
waiting room
chat
camera
microphone
screen share
reaction
raise hand
room lock
```

---

## `meeting-end`

Chỉ Host.

Làm:

```text
verify host
mark meeting ended
disconnect/remove participants nếu cần
write audit event
```

---

## `security-event`

Server-side use.

Không cho browser tự quyết định:

```text
riskScore
block
ban
```

---

# 13. LIVEKIT TOKEN

Luồng chuẩn:

```text
Browser
   |
   | authenticated Supabase session
   v
meeting-token Edge Function
   |
   +-- verify user
   +-- verify meeting
   +-- verify membership
   +-- verify waiting approval
   +-- verify not blocked
   +-- verify not removed
   +-- verify room capacity
   +-- calculate permissions
   |
   v
LiveKit signed token
   |
   v
Browser -> LiveKit Room
```

Token phải có thời gian sống hợp lý.

Không dùng:

```text
email
phone number
full real name
```

làm LiveKit participant identity.

Dùng UUID/app identity không chứa PII.

---

# 14. MEDIA PERFORMANCE CHO TỐI ĐA 50 USER

## Không làm

```text
50 camera
=
50 video 720p render cùng lúc
```

## Làm

Mặc định:

```text
9 hoặc 16 video tile đang thấy
```

Có thể:

```text
25 tile trên desktop mạnh
```

Người còn lại:

```text
participant list
pagination
virtualized list
```

Ưu tiên chất lượng:

```text
1. Screen share
2. Active speaker
3. Pinned participant
4. Visible tiles
5. Background/offscreen participants
```

---

# 15. LIVEKIT CLIENT CONFIG

Khởi tạo gần dạng:

```javascript
const room = new Room({
  adaptiveStream: true,
  dynacast: true,
  videoCaptureDefaults: {
    resolution: VideoPresets.h720.resolution
  }
});
```

Ý nghĩa:

```text
adaptiveStream
→ tự điều chỉnh chất lượng video nhận theo kích thước/visibility tile

dynacast
→ giảm CPU/bandwidth bằng cách dừng layer không có subscriber cần
```

Không hard-code 1080p cho mọi camera.

---

# 16. SCREEN SHARE

Luồng:

```text
User bấm Share Screen
        |
        v
Browser permission
        |
        v
Tab / Window / Entire screen
        |
        v
LiveKit screen track
        |
        v
SFU
        |
        v
Other participants
```

Khi share:

```text
Screen share = main stage
Camera participants = filmstrip / small grid
```

Khi stop:

```text
return grid layout
```

---

# 17. CHAT

Chat text:

```text
Browser
   |
   v
Supabase
   |
   v
messages table
   |
   v
Realtime
   |
   v
Meeting clients
```

Message phải được sanitize/escape khi render.

Không cho người dùng gửi raw HTML.

Rate limit spam.

---

# 18. PRESENCE / REALTIME

Supabase Realtime dùng cho:

```text
waiting room state
join request
chat notification
application presence
meeting state
reaction
raise hand
```

LiveKit dùng cho media state.

Không update database hàng chục lần mỗi giây cho:

```text
audio level
video frame
mouse movement
continuous waveform
```

---

# 19. HOST CONTROL

Host có thể:

```text
Approve waiting participant
Reject participant
Kick participant
Assign co-host
Remove co-host
Stop screen share
Lock room
Update meeting settings
End meeting for all
```

Frontend chỉ gửi yêu cầu.

Server kiểm tra quyền thật.

---

# 20. ZERO-TRUST SECURITY

Hacker có thể sửa:

```javascript
role = 'host'
```

UI của hacker có thể hiện Host button.

Nhưng khi họ gọi:

```text
END_MEETING
```

server:

```text
verify JWT
   |
get auth.uid()
   |
query database role
   |
member != host
   |
403
   |
security event
```

Đây là bảo mật thật.

---

# 21. SECURITY RESPONSE

Không block chỉ vì user mở DevTools.

Chỉ xử lý hành vi server-side bất thường.

Ví dụ:

```text
1 unauthorized action
→ 403 + log

repeated unauthorized actions
→ rate limit + warning

continued abuse
→ temporary block

meeting abuse
→ remove participant

severe repeated abuse
→ account restriction/manual review
```

Tránh auto-ban vĩnh viễn chỉ từ một lỗi.

---

# 22. CLIENT SECURITY UI

Client chỉ hiển thị response của server.

Ví dụ:

```text
403 PERMISSION_DENIED
→ "Bạn không có quyền thực hiện thao tác này."

429 RATE_LIMITED
→ "Bạn thao tác quá nhanh. Vui lòng thử lại."

ACCOUNT_TEMP_BLOCKED
→ "Tài khoản đang tạm thời bị giới hạn."

REMOVED_FROM_MEETING
→ "Bạn đã bị rời khỏi cuộc họp."
```

Không trả chi tiết rule detection cho attacker.

---

# 23. CODE STYLE

## JavaScript

Dùng:

```text
const / let
async / await
ES Modules
optional chaining
early return
small functions
clear naming
```

Không dùng:

```text
var
global variables tràn lan
callback hell
nested if quá sâu
magic numbers
inline secret
eval()
```

---

## Ví dụ tốt

```javascript
export async function joinMeeting(roomCode) {
  if (!roomCode) {
    throw new Error('ROOM_CODE_REQUIRED');
  }

  const meeting = await getMeetingByCode(roomCode);

  if (!meeting) {
    throw new Error('MEETING_NOT_FOUND');
  }

  return meeting;
}
```

---

## Naming

Function:

```text
createMeeting()
joinMeeting()
leaveMeeting()
startScreenShare()
stopScreenShare()
loadParticipants()
sendChatMessage()
approveParticipant()
endMeeting()
```

Không:

```text
doThing()
handle2()
func()
testFunction()
abc()
```

---

# 24. ERROR HANDLING

Mỗi lỗi cần có code rõ.

Ví dụ:

```text
AUTH_REQUIRED
MEETING_NOT_FOUND
MEETING_ENDED
MEETING_LOCKED
ROOM_FULL
WAITING_APPROVAL
PERMISSION_DENIED
USER_BLOCKED
TOKEN_CREATE_FAILED
MEDIA_PERMISSION_DENIED
CAMERA_NOT_FOUND
MICROPHONE_NOT_FOUND
LIVEKIT_CONNECT_FAILED
NETWORK_DISCONNECTED
```

UI map code sang thông báo thân thiện.

Không phụ thuộc vào text exception để quyết định logic.

---

# 25. LOGGING

Development:

```text
console.debug
console.info
console.warn
console.error
```

Production:

Không spam console.

Server log phải có:

```text
requestId
function
userId nếu có
meetingId nếu có
action
result
errorCode
durationMs
```

Không log:

```text
password
secret
full access token
API secret
sensitive personal content
```

---

# 26. DEBUG STRATEGY

Khi lỗi phải xác định theo lớp.

```text
UI lỗi?
↓
Browser console

API lỗi?
↓
Network tab

Supabase request lỗi?
↓
Edge Function logs

Database permission lỗi?
↓
RLS policy / grants

Media lỗi?
↓
LiveKit events / browser WebRTC info

Deploy lỗi?
↓
GitHub Actions logs
```

Không sửa ngẫu nhiên nhiều file cùng lúc.

Quy trình:

```text
reproduce
isolate
identify layer
fix smallest responsible module
test
commit
```

---

# 27. PERFORMANCE RULES FRONTEND

Dùng:

```text
CSS Grid
Flexbox
ES Modules
lazy loading
event delegation
DocumentFragment
IntersectionObserver khi cần
requestAnimationFrame cho animation
debounce/throttle đúng chỗ
```

Tránh:

```text
1000 DOM nodes không cần thiết
render lại toàn meeting
polling 1 giây nếu có realtime
large image
base64 media
giant JS bundle
huge dependency
```

---

# 28. UI STATE

Mỗi màn cần các trạng thái:

```text
loading
success
empty
error
offline/reconnecting
permission denied
```

Meeting toolbar phải phản hồi tức thì.

Ví dụ:

```text
mic click
→ UI đổi ngay
→ LiveKit operation
→ rollback nếu operation fail
```

---

# 29. RESPONSIVE

Desktop:

```text
main stage
side panel
bottom toolbar
```

Mobile:

```text
single main stage
horizontal participant strip
bottom toolbar
chat/participants as drawer
```

Không nhồi layout desktop nguyên bản vào mobile.

---

# 30. ACCESSIBILITY

Bắt buộc:

```text
button có aria-label
keyboard focus rõ
modal trap focus
ESC đóng modal hợp lệ
icon button có tooltip
contrast đủ
video tile có tên participant
```

Không chỉ dựa vào màu để biểu thị trạng thái.

---

# 31. GITHUB WORKFLOW

Development:

```bash
git checkout -b feature/meeting-chat
git add .
git commit -m "feat: add realtime meeting chat"
git push
```

Branch:

```text
main
feature/*
fix/*
security/*
```

Commit:

```text
feat:
fix:
refactor:
perf:
security:
docs:
test:
chore:
```

---

# 32. VITE

Vite chỉ dùng để:

```text
dev server
ES module dependency management
minify
tree-shake
asset hashing
production build
```

Không dùng framework nếu chưa có yêu cầu.

Source vẫn là:

```text
HTML
CSS
JavaScript
```

---

# 33. PACKAGE POLICY

Giữ dependency nhỏ.

Cần thiết:

```text
vite
@supabase/supabase-js
livekit-client
```

Không thêm package nếu Web API/native JS giải quyết tốt.

Trước khi thêm dependency, AI phải tự hỏi:

```text
Native browser API làm được không?
Project có thật sự cần package này không?
Package có tăng bundle đáng kể không?
Package có còn được maintain không?
```

---

# 34. ENVIRONMENT

`.env.example`

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_LIVEKIT_URL=
VITE_TURNSTILE_SITE_KEY=
```

Chỉ chứa public config.

Secrets đặt trong Supabase Edge Function Secrets:

```text
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
TURNSTILE_SECRET_KEY
```

---

# 35. BUILD

Local:

```bash
npm install
npm run dev
```

Production:

```bash
npm run build
```

Output:

```text
dist/
```

Không chỉnh trực tiếp file trong `dist`.

---

# 36. GITHUB PAGES DEPLOY

GitHub repository chứa source.

GitHub Actions:

```text
push main
    |
    v
npm ci
    |
    v
npm run build
    |
    v
dist/
    |
    v
GitHub Pages
```

Website:

```text
https://USERNAME.github.io/flash-meeting/
```

hoặc custom domain:

```text
https://meet.yourdomain.com
```

Bật:

```text
Enforce HTTPS
```

Camera/micro/screen share production cần secure context.

---

# 37. VITE BASE PATH

Nếu deploy dạng:

```text
https://USERNAME.github.io/flash-meeting/
```

Vite phải cấu hình đúng base:

```javascript
export default defineConfig({
  base: '/flash-meeting/'
});
```

Nếu dùng custom domain root:

```text
https://meet.example.com/
```

có thể dùng:

```javascript
base: '/'
```

---

# 38. SUPABASE DEPLOY

Migration:

```text
001_database_schema.sql
002_rls_policies.sql
003_security_schema.sql
```

Không chỉnh production database thủ công nếu thay đổi có thể được migration hóa.

Edge Functions deploy từ:

```text
supabase/functions/
```

Có thể dùng Supabase CLI + GitHub Actions sau khi project ổn định.

---

# 39. GITHUB SECRETS

GitHub Actions chỉ lưu secret cần cho CI/CD.

Không commit secret vào repo.

Nếu deploy Supabase Functions qua GitHub Actions, dùng GitHub Actions Secrets.

Không echo secret trong log.

---

# 40. TEST PLAN

## Unit / module test

Test:

```text
room code validation
permission mapping
error mapping
input sanitization
meeting state helpers
```

## Integration test

Test:

```text
login
create meeting
join meeting
waiting room
approve join
token generation
LiveKit connect
chat
screen share
kick
end meeting
```

## Security test

Test:

```text
member tries to become host
member calls end meeting
member approves self
blocked user requests token
removed user rejoins
invalid JWT
expired session
direct Supabase REST call
RLS access to another meeting
chat injection/XSS
spam requests
```

## Load test

Không test quá 50 browser thật trong V1.

Stages:

```text
2 users
5 users
10 users
25 users
50 users
```

Theo dõi:

```text
CPU
memory
network
video quality
join latency
reconnect
Supabase request rate
LiveKit metrics
browser responsiveness
```

---

# 41. CODE REVIEW CHECKLIST

Trước merge:

```text
[ ] File name đúng chức năng
[ ] Không secret
[ ] Không duplicate logic
[ ] Không giant function
[ ] Không raw innerHTML từ user content
[ ] Error code rõ
[ ] Loading/error UI
[ ] Authorization server-side
[ ] RLS tồn tại
[ ] Mobile usable
[ ] No console spam
[ ] No dead code
[ ] No unused dependency
[ ] Build pass
[ ] Main user flow pass
```

---

# 42. AI CODING RULES

AI triển khai project phải:

1. Đọc file này trước khi code.
2. Không tự đổi framework.
3. Không chuyển sang React/Vue/Angular nếu không được yêu cầu.
4. Không thay Supabase bằng backend khác.
5. Không thay LiveKit bằng WebRTC mesh tự viết.
6. Không tạo backend Node.js riêng nếu chưa có lý do rõ.
7. Không đưa secret vào client.
8. Không bỏ RLS.
9. Không kiểm tra quyền chỉ ở frontend.
10. Không tạo file tên mơ hồ.
11. Không sửa nhiều module không liên quan.
12. Ưu tiên patch nhỏ, rõ và test được.
13. Sau mỗi feature phải chạy build.
14. Khi sửa bug phải xác định nguyên nhân gốc.
15. Không phá logic đang chạy để “refactor cho đẹp”.
16. Giữ backward compatibility nếu database/API đã có user.
17. Viết comment cho phần khó, không comment mọi dòng.
18. Xóa debug code trước production.
19. Không thêm dependency chỉ để tiết kiệm vài dòng code.
20. Luôn ưu tiên hiệu năng, bảo mật và khả năng bảo trì.

---

# 43. FEATURE IMPLEMENTATION ORDER

Triển khai theo workflow **FRONTEND-FIRST + BACKEND-AWARE**.

Trong các phase UI, thư mục `supabase/` và các file LiveKit được đóng băng,
trừ khi task nêu rõ yêu cầu triển khai backend hoặc media. Các phần backend và
media trong tài liệu này vẫn là kiến trúc mục tiêu cho các phase sau.

During UI phases, Supabase and LiveKit folders are frozen unless a task explicitly requests backend/media implementation.

## Phase 0 — Deep project audit / project knowledge

```text
Source audit
Architecture map
UX and business-flow map
Implemented / partial / scaffold / mock classification
Security-boundary verification
```

## Phase 1 — Design System + shared frontend foundation

```text
Vite
Base CSS
Shared tokens and components
Responsive foundation
GitHub Pages-compatible paths
Public configuration boundary
```

## Phase 2 — Login UI complete

```text
Login layout
Validation
Mock session flow
Loading and error states
Safe redirects
Accessibility and responsive behavior
```

## Phase 3 — Dashboard UI complete

```text
Session gate
Profile and notifications
Create / join actions
Active, upcoming, and recent meeting states
Loading, empty, partial-error, offline, and expired states
```

## Phase 4 — Create Meeting UI

```text
Meeting details
Settings form
Confirmation flow
Frontend mock contract
```

## Phase 5 — Join Meeting UI

```text
Room code or meeting URL
Validation
Resolve and state feedback
Frontend mock contract
```

## Phase 6 — Pre-Join UI

```text
Local camera preview
Microphone preview
Device selectors
Permission states
Join action
```

## Phase 7 — Waiting Room UI

```text
Join request state
Waiting / approved / rejected states
Host-action placeholders
Frontend mock transitions
```

## Phase 8 — Meeting Room UI

```text
Room shell
Toolbar
Participant layout
Leave / end states
Responsive layout
```

## Phase 9 — Participants / Chat / Screen Share / Host UI

```text
Participant panel
Chat surface
Screen-share surface
Host-control surface
Reactions and raise hand
```

## Phase 10 — Frontend mock interactions + full state coverage

```text
Happy paths
Loading states
Empty states
Partial errors
Offline states
Permission and recovery states
```

## Phase 11 — Freeze frontend data contracts

```text
Page-to-service contracts
Meeting and participant models
Error codes
State transitions
Backend-neutral UI boundaries
```

## Phase 12 — Supabase Database + Auth

```text
Database schema
Supabase Auth
Profiles and meeting data
```

## Phase 13 — RLS + Edge Functions + Realtime + Storage

```text
RLS policies
Server-authority Edge Functions
Application Realtime
Storage policies
```

## Phase 14 — LiveKit / WebRTC / SFU

```text
meeting-token Edge Function
LiveKit connect
Camera and microphone tracks
Remote tracks
Active speaker
Reconnect
Screen share
```

## Phase 15 — Frontend ↔ Backend integration

```text
Replace mock services
Connect authenticated data flows
Connect server-authorized meeting actions
```

## Phase 16 — Security hardening

```text
Security events
Rate limits
Temporary blocks
Turnstile
Abuse detection
CSP
Storage policies
```

## Phase 17 — Performance / load testing

```text
Adaptive stream
Dynacast
Visible tiles only
Virtual participant list
Asset optimization
Bundle inspection
Load testing
```

## Phase 18 — Production GitHub Pages deployment

```text
GitHub Pages
HTTPS
Custom domain
Supabase production
LiveKit production
Logging
Monitoring
```

---

# 44. DEFINITION OF DONE

FLASH MEETING V1 được xem là hoàn thành khi:

```text
✓ User register/login
✓ User create meeting
✓ Room code/link hoạt động
✓ User prejoin preview
✓ Waiting room hoạt động
✓ Host approve/reject
✓ 2+ user camera/micro realtime
✓ Screen share hoạt động
✓ Chat realtime
✓ Participant list hoạt động
✓ Host moderation hoạt động
✓ End meeting hoạt động
✓ RLS security test pass
✓ Client không chứa secret
✓ LiveKit token server-generated
✓ GitHub Pages production HTTPS
✓ Mobile usable
✓ Desktop usable
✓ Reconnect có xử lý
✓ Build sạch
✓ No critical console error
✓ Không có dead/test file trong production
```

Sau đó mới scale test lên:

```text
10
25
50
```

---

# 45. PERFORMANCE / SECURITY DECISION SUMMARY

## Frontend

```text
Vanilla JS
Vite
GitHub Pages
ES Modules
small bundle
```

## Backend

```text
Supabase
PostgreSQL
RLS
Edge Functions
```

## Media

```text
LiveKit SFU
WebRTC
adaptiveStream
dynacast
```

## Security

```text
Zero-trust frontend
JWT
RLS
Edge authorization
signed LiveKit token
rate limiting
security logs
temporary blocks
optional Cloudflare/Turnstile
```

---

# 46. KHÔNG ĐƯỢC LÀM

```text
NO WebRTC full mesh cho 50 user
NO video through Supabase Realtime
NO base64 screen streaming
NO secret in GitHub frontend
NO service role in browser
NO LiveKit API secret in browser
NO client-only host authorization
NO giant script.js
NO random file names
NO unnecessary framework
NO duplicate business logic
NO direct production database edits without migration
NO raw user HTML rendering
NO permanent ban from one suspicious request
```

---

# 47. KIẾN TRÚC CUỐI CÙNG

```text
                     FLASH MEETING
                          |
                          v
                  GitHub Repository
                          |
                          v
                    GitHub Actions
                          |
                          v
                    GitHub Pages
                          |
                HTML / CSS / JS / Vite
                          |
             +------------+------------+
             |                         |
             v                         v
         SUPABASE                   LIVEKIT
             |                         |
          Auth                        SFU
          RLS                       WebRTC
          DB                        Camera
          Realtime                  Micro
          Storage                   Screen
          Edge Functions
             |
             v
      SERVER AUTHORIZATION
             |
             v
      SECURITY / AUDIT / BLOCK
```

---

# 48. NGUYÊN TẮC CUỐI CHO AI

> **FLASH MEETING phải đơn giản ở source nhưng mạnh ở kiến trúc.**

AI không được đánh đổi:

```text
dễ code
```

bằng:

```text
bảo mật yếu
code dồn một file
logic trùng lặp
khó debug
khó scale
```

Mỗi chức năng phải nằm đúng file có tên rõ ràng.

Mọi quyền quan trọng phải được xác minh phía server.

Mọi media phải đi qua LiveKit/WebRTC.

Mọi dữ liệu ứng dụng phải được kiểm soát bằng Supabase Auth + RLS.

GitHub Pages chỉ là frontend và phải luôn được coi là public/untrusted.

Khi cần nâng cấp:

```text
tìm đúng file theo tên
sửa đúng module
test module
build
deploy
```

không cần đọc lại toàn bộ project.

---

# 49. TÀI LIỆU CHÍNH THỨC CẦN ƯU TIÊN

Khi API hoặc syntax thay đổi, AI phải ưu tiên tài liệu chính thức mới nhất:

- GitHub Pages documentation
- Supabase documentation
- Supabase Auth / RLS / Edge Functions documentation
- LiveKit JavaScript Client SDK documentation
- LiveKit Server SDK documentation
- MDN Web APIs documentation

Không copy tutorial cũ nếu xung đột với tài liệu chính thức hiện tại.

---

# 50. PROJECT MOTTO

```text
CLEAR FILES
CLEAN CODE
SERVER AUTHORITY
FAST UI
STRONG SECURITY
REALTIME MEDIA
EASY DEBUG
EASY UPGRADE
EASY DEPLOY
```

**Project:** FLASH MEETING  
**Architecture status:** APPROVED BASELINE  
**Primary deployment:** GitHub Pages + Supabase + LiveKit  
**Frontend policy:** HTML/CSS/Vanilla JS + Vite  
**V1 scale target:** tối đa 50 participants / meeting  
