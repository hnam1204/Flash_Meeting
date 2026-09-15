import { authService } from './auth-service.js';
import { meetingService } from './meeting-service.js';

export const dashboardService = Object.freeze({
  async load() {
    const session = authService.getSession();
    const [activeMeetings, meetingHistory] = await Promise.all([
      meetingService.listActiveMeetings(session),
      meetingService.listMeetingHistory(session)
    ]);
    return {
      user: session,
      activeMeetings,
      meetingHistory,
      offline: false,
      errors: {}
    };
  }
});
