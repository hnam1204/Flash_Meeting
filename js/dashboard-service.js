import { authService } from './auth-service.js';
import { meetingService } from './meeting-service.js';

const wait = (duration) => new Promise((resolve) => window.setTimeout(resolve, duration));

export const dashboardService = Object.freeze({
  async load({ scenario = 'normal' } = {}) {
    await wait(460);

    if (scenario === 'error') throw new Error('DASHBOARD_LOAD_FAILED');

    const session = authService.getSession();
    const [activeMeetings, meetingHistory] = await Promise.all([
      scenario === 'empty' ? Promise.resolve([]) : meetingService.listActiveMeetings(session),
      meetingService.listMeetingHistory(session)
    ]);
    const result = {
      user: session,
      activeMeetings,
      meetingHistory,
      offline: scenario === 'offline',
      errors: {}
    };

    if (scenario === 'empty') result.activeMeetings = [];
    if (scenario === 'partial-error') result.errors.active = 'Không thể tải cuộc họp đang diễn ra.';

    return result;
  }
});
