import { getMockSession, MOCK_USER_ID } from './auth-service.js';

const MOCK_USER = Object.freeze({
  id: MOCK_USER_ID,
  displayName: 'Nguyễn Hải Nam',
  email: 'demo@flashmeeting.app',
  avatarUrl: null
});

const ACTIVE_MEETINGS = Object.freeze([
  {
    id: 'meeting-002',
    roomCode: 'DESIGN-204',
    title: 'Design review · Q3 workspace',
    status: 'active',
    startAt: '2026-09-11T10:30:00+07:00',
    endAt: '2026-09-11T11:30:00+07:00',
    displayDate: 'Đang diễn ra',
    displayTime: '10:30 – 11:30',
    hostName: 'Linh Trần',
    participantCount: 8
  }
]);

const UPCOMING_MEETINGS = Object.freeze([
  {
    id: 'meeting-001',
    roomCode: 'FLASH-101',
    title: 'Họp nhóm FLASH MEETING',
    status: 'scheduled',
    startAt: '2026-09-11T14:00:00+07:00',
    endAt: '2026-09-11T15:00:00+07:00',
    displayDate: 'Hôm nay',
    displayTime: '14:00 – 15:00',
    hostName: 'Nguyễn Hải Nam',
    participantCount: 5
  },
  {
    id: 'meeting-003',
    roomCode: 'SPRINT-309',
    title: 'Sprint planning tuần 38',
    status: 'scheduled',
    startAt: '2026-09-12T09:30:00+07:00',
    endAt: '2026-09-12T10:30:00+07:00',
    displayDate: 'Ngày mai',
    displayTime: '09:30 – 10:30',
    hostName: 'Minh Phạm',
    participantCount: 12
  }
]);

const RECENT_MEETINGS = Object.freeze([
  {
    id: 'meeting-004',
    roomCode: 'WEEKLY-118',
    title: 'Weekly product sync',
    status: 'ended',
    startAt: '2026-09-10T09:00:00+07:00',
    endAt: '2026-09-10T09:45:00+07:00',
    displayDate: 'Hôm qua · 09:00',
    duration: '45 phút',
    hostName: 'Nguyễn Hải Nam',
    participantCount: 6
  },
  {
    id: 'meeting-005',
    roomCode: 'KICKOFF-88',
    title: 'Client kickoff · Bluebird',
    status: 'ended',
    startAt: '2026-09-08T15:00:00+07:00',
    endAt: '2026-09-08T16:10:00+07:00',
    displayDate: '08/09/2026 · 15:00',
    duration: '1 giờ 10 phút',
    hostName: 'Mai Nguyễn',
    participantCount: 9
  },
  {
    id: 'meeting-006',
    roomCode: 'RESEARCH-45',
    title: 'Research notes · Week 36',
    status: 'ended',
    startAt: '2026-09-05T11:00:00+07:00',
    endAt: '2026-09-05T11:35:00+07:00',
    displayDate: '05/09/2026 · 11:00',
    duration: '35 phút',
    hostName: 'Nguyễn Hải Nam',
    participantCount: 4
  }
]);

const NOTIFICATIONS = Object.freeze([
  { id: 'notification-001', type: 'meeting', text: 'Cuộc họp “Họp nhóm FLASH MEETING” bắt đầu sau 10 phút.', time: '2 phút trước' },
  { id: 'notification-002', type: 'invite', text: 'Bạn được mời tham gia cuộc họp Design review · Q3 workspace.', time: '35 phút trước' },
  { id: 'notification-003', type: 'calendar', text: 'Lịch họp Sprint planning tuần 38 đã được cập nhật.', time: 'Hôm qua' }
]);

const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

function clone(items) {
  return items.map((item) => ({ ...item }));
}

export const dashboardService = Object.freeze({
  async load({ scenario = 'normal' } = {}) {
    await wait(460);

    if (scenario === 'error') throw new Error('DASHBOARD_LOAD_FAILED');

    const session = getMockSession();
    const result = {
      user: {
        ...MOCK_USER,
        displayName: session?.displayName ?? MOCK_USER.displayName,
        email: session?.email ?? MOCK_USER.email
      },
      activeMeetings: clone(ACTIVE_MEETINGS),
      upcomingMeetings: clone(UPCOMING_MEETINGS),
      recentMeetings: clone(RECENT_MEETINGS),
      unreadNotifications: NOTIFICATIONS.length,
      notifications: clone(NOTIFICATIONS),
      offline: scenario === 'offline',
      errors: {}
    };

    if (scenario === 'empty') {
      result.activeMeetings = [];
      result.upcomingMeetings = [];
      result.recentMeetings = [];
    }

    if (scenario === 'partial-error') {
      result.errors.upcoming = 'Không thể tải cuộc họp sắp tới.';
    }

    return result;
  }
});
