import {
  ANALYTICS_ERROR_CODES,
  getGlobalAnalytics,
  recordVisit,
  subscribeGlobalAnalytics
} from './analytics-service.js';
import { createAnalyticsChart } from './analytics-chart.js';
import { renderIcons } from './ui/icons.js';

const controllerByRoot = new WeakMap();
const VISIT_HEARTBEAT_MS = 10 * 60 * 1000;
let visitTrackingStarted = false;

export function startVisitTracking() {
  if (visitTrackingStarted) return;
  visitTrackingStarted = true;
  void recordVisit();
  if (typeof window !== 'undefined') {
    window.setInterval(() => { void recordVisit(); }, VISIT_HEARTBEAT_MS);
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat('vi-VN').format(Math.max(0, Number(value) || 0));
}

function formatUpdatedAt(value) {
  if (!value) return 'Chưa có dữ liệu cập nhật';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa có dữ liệu cập nhật';
  return `Cập nhật ${new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)}`;
}

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function getErrorMessage(error) {
  if (isOffline() || error?.code === ANALYTICS_ERROR_CODES.NETWORK_ERROR) {
    return 'Không thể kết nối. Số liệu hiện tại vẫn được giữ nguyên.';
  }
  if (error?.code === ANALYTICS_ERROR_CODES.BACKEND_NOT_READY) {
    return 'System analytics backend chưa được kích hoạt. Hãy áp dụng migration Supabase rồi thử lại.';
  }
  if (error?.code === ANALYTICS_ERROR_CODES.AUTH_REQUIRED) {
    return 'Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.';
  }
  if (error?.code === ANALYTICS_ERROR_CODES.CONFIGURATION_ERROR) {
    return 'Supabase chưa được cấu hình cho môi trường này.';
  }
  return 'Không thể tải thống kê lúc này. Vui lòng thử lại.';
}

export function createAnalyticsController(root = document.querySelector('[data-system-analytics]')) {
  if (!root) return Object.freeze({ start: () => {}, destroy: () => {} });
  if (controllerByRoot.has(root)) return controllerByRoot.get(root);

  const toggle = root.querySelector('[data-analytics-toggle]');
  const panel = root.querySelector('[data-analytics-panel]');
  const toggleLabel = root.querySelector('[data-analytics-toggle-label]');
  const feedback = root.querySelector('[data-analytics-feedback]');
  const liveStatus = root.querySelector('[data-analytics-live-status]');
  const loading = root.querySelector('[data-analytics-loading]');
  const retryButton = root.querySelector('[data-analytics-retry]');
  const chartRoot = root.querySelector('[data-analytics-chart]');
  const chart = chartRoot ? createAnalyticsChart(chartRoot) : null;
  const valueNodes = new Map(
    [...root.querySelectorAll('[data-analytics-value]')]
      .map((node) => [node.dataset.analyticsValue, node])
  );

  let started = false;
  let open = false;
  let snapshot = null;
  let loadInFlight = null;
  let refreshTimer = 0;
  let unsubscribeRealtime = null;
  let onlineHandler;
  let offlineHandler;

  function setFeedback(message = '', state = '') {
    if (!feedback) return;
    feedback.textContent = message;
    feedback.dataset.state = state;
    feedback.hidden = !message;
  }

  function setLiveStatus(status = '') {
    if (!liveStatus) return;
    const labels = {
      SUBSCRIBED: 'Trực tiếp',
      CHANNEL_ERROR: 'Đang kết nối lại...',
      TIMED_OUT: 'Đang kết nối lại...',
      CLOSED: 'Tạm dừng',
      UNAVAILABLE: 'Chưa sẵn sàng'
    };
    liveStatus.textContent = labels[status] || (isOffline() ? 'Đang kết nối lại...' : 'Đang kết nối...');
    liveStatus.dataset.state = status.toLowerCase();
  }

  function renderSnapshot(nextSnapshot) {
    snapshot = nextSnapshot;
    const summary = snapshot.summary;
    ['totalVisits', 'totalUsers', 'totalMeetings', 'activeMeetings'].forEach((key) => {
      const node = valueNodes.get(key);
      if (node) node.textContent = formatNumber(summary[key]);
    });
    const updated = root.querySelector('[data-analytics-updated]');
    if (updated) updated.textContent = formatUpdatedAt(summary.updatedAt);
    chart?.render(snapshot.activity24h);
  }

  function setLoadingState(isLoading) {
    root.dataset.analyticsState = !open ? 'collapsed' : isLoading ? 'loading' : snapshot ? 'ready' : 'error';
    if (loading) loading.hidden = !isLoading;
    toggle?.setAttribute('aria-busy', String(isLoading));
  }

  function subscribeRealtime() {
    if (unsubscribeRealtime) return;
    unsubscribeRealtime = subscribeGlobalAnalytics({
      onChange: () => {
        if (refreshTimer) return;
        refreshTimer = window.setTimeout(() => {
          refreshTimer = 0;
          void loadSnapshot({ silent: true });
        }, 240);
      },
      onStatus: (status) => {
        setLiveStatus(status);
        if (status === 'SUBSCRIBED' && snapshot) setFeedback('', '');
        if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status) && snapshot) {
          setFeedback('Đang kết nối lại...', 'info');
        }
      }
    });
  }

  async function loadSnapshot({ silent = false } = {}) {
    if (loadInFlight) return loadInFlight;
    loadInFlight = (async () => {
      if (!silent || !snapshot) setLoadingState(true);
      if (!silent && !snapshot) setFeedback('', '');
      try {
        const nextSnapshot = await getGlobalAnalytics();
        renderSnapshot(nextSnapshot);
        setLoadingState(false);
        setFeedback('', '');
        if (!open) return nextSnapshot;
        setLiveStatus(isOffline() ? 'CHANNEL_ERROR' : 'CONNECTING');
        if (retryButton) retryButton.hidden = true;
        subscribeRealtime();
        return nextSnapshot;
      } catch (error) {
        if (!open) return null;
        setLoadingState(false);
        if (snapshot) {
          setFeedback(isOffline() ? 'Đang kết nối lại...' : getErrorMessage(error), 'info');
        } else {
          setFeedback(getErrorMessage(error), 'error');
          if (retryButton) retryButton.hidden = false;
          setLiveStatus('CHANNEL_ERROR');
        }
        return null;
      } finally {
        loadInFlight = null;
      }
    })();
    return loadInFlight;
  }

  function setOpen(nextOpen) {
    open = Boolean(nextOpen);
    root.dataset.analyticsState = open ? (snapshot ? 'ready' : 'loading') : 'collapsed';
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggleLabel.textContent = open ? 'Ẩn thống kê' : 'Thống kê hệ thống';
    if (!open) {
      window.clearTimeout(refreshTimer);
      refreshTimer = 0;
      unsubscribeRealtime?.();
      unsubscribeRealtime = null;
      return;
    }
    if (retryButton) retryButton.hidden = true;
    void loadSnapshot();
  }

  function handleRetry() {
    if (!open) setOpen(true);
    if (retryButton) retryButton.hidden = true;
    void loadSnapshot();
  }

  function handleOnline() {
    if (!open) return;
    setFeedback(snapshot ? 'Đang kết nối lại...' : '', 'info');
    void loadSnapshot({ silent: Boolean(snapshot) });
  }

  function handleOffline() {
    if (!open) return;
    setLiveStatus('CHANNEL_ERROR');
    if (snapshot) setFeedback('Đang kết nối lại...', 'info');
  }

  function start() {
    if (started) return;
    started = true;
    toggle?.addEventListener('click', () => setOpen(!open));
    retryButton?.addEventListener('click', handleRetry);
    onlineHandler = handleOnline;
    offlineHandler = handleOffline;
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    setOpen(false);
  }

  function destroy() {
    window.clearTimeout(refreshTimer);
    unsubscribeRealtime?.();
    unsubscribeRealtime = null;
    window.removeEventListener('online', onlineHandler);
    window.removeEventListener('offline', offlineHandler);
    chart?.destroy();
    controllerByRoot.delete(root);
  }

  const controller = Object.freeze({ start, destroy, load: loadSnapshot });
  controllerByRoot.set(root, controller);
  return controller;
}

// Public pages count visits too; the server decides whether a heartbeat is a new session.
startVisitTracking();

if (typeof document !== 'undefined') {
  renderIcons();
}
