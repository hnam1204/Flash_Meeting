const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 760;
const HEIGHT = 300;
const PADDING = Object.freeze({ top: 18, right: 18, bottom: 42, left: 46 });

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatTooltip(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Thời gian không khả dụng';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function getMaxValue(buckets) {
  const highest = buckets.reduce((max, bucket) => Math.max(max, bucket.visits, bucket.meetingsStarted), 0);
  if (highest <= 4) return 4;
  return Math.ceil(highest / 4) * 4;
}

function pointFor(index, value, count, maxValue) {
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  return {
    x: PADDING.left + (count <= 1 ? chartWidth / 2 : (index / (count - 1)) * chartWidth),
    y: PADDING.top + chartHeight - (value / maxValue) * chartHeight
  };
}

function createPath(buckets, key, maxValue) {
  return buckets.map((bucket, index) => {
    const point = pointFor(index, bucket[key], buckets.length, maxValue);
    return `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ');
}

function appendGrid(svg, maxValue) {
  const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
  const chartWidth = WIDTH - PADDING.left - PADDING.right;
  for (let index = 0; index <= 4; index += 1) {
    const ratio = index / 4;
    const y = PADDING.top + chartHeight - ratio * chartHeight;
    const line = createSvgElement('line', {
      x1: PADDING.left,
      y1: y,
      x2: WIDTH - PADDING.right,
      y2: y,
      class: 'analytics-chart__grid-line'
    });
    svg.append(line);

    const label = createSvgElement('text', {
      x: PADDING.left - 10,
      y: y + 4,
      class: 'analytics-chart__axis-label',
      'text-anchor': 'end'
    });
    label.textContent = String(Math.round(maxValue * ratio));
    svg.append(label);
  }

  const baseline = createSvgElement('line', {
    x1: PADDING.left,
    y1: PADDING.top + chartHeight,
    x2: WIDTH - PADDING.right,
    y2: PADDING.top + chartHeight,
    class: 'analytics-chart__baseline'
  });
  svg.append(baseline);
  return chartWidth;
}

function appendXLabels(svg, buckets) {
  const indexes = [...new Set([0, 4, 8, 12, 16, 20, buckets.length - 1])]
    .filter((index) => index >= 0 && index < buckets.length);
  indexes.forEach((index) => {
    const point = pointFor(index, 0, buckets.length, 1);
    const label = createSvgElement('text', {
      x: point.x,
      y: HEIGHT - 12,
      class: 'analytics-chart__axis-label',
      'text-anchor': index === 0 ? 'start' : index === buckets.length - 1 ? 'end' : 'middle'
    });
    label.textContent = formatTime(buckets[index].time);
    svg.append(label);
  });
}

function appendSeries(svg, buckets, key, className, label, maxValue) {
  const path = createSvgElement('path', {
    d: createPath(buckets, key, maxValue),
    class: `analytics-chart__line ${className}`,
    'aria-label': label
  });
  svg.append(path);

  buckets.forEach((bucket, index) => {
    const point = pointFor(index, bucket[key], buckets.length, maxValue);
    const circle = createSvgElement('circle', {
      cx: point.x,
      cy: point.y,
      r: 3.5,
      class: `analytics-chart__point ${className}`,
      tabindex: '0'
    });
    const title = createSvgElement('title');
    title.textContent = `${label}: ${bucket[key]} · ${formatTooltip(bucket.time)}`;
    circle.append(title);
    svg.append(circle);
  });
}

export function createAnalyticsChart(root) {
  let rendered = false;

  function render(input = []) {
    const buckets = Array.isArray(input) && input.length
      ? input.filter((bucket) => bucket?.time)
      : [];
    root.replaceChildren();
    if (!buckets.length) {
      rendered = false;
      return;
    }

    const maxValue = getMaxValue(buckets);
    const svg = createSvgElement('svg', {
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      role: 'img',
      'aria-label': 'Biểu đồ đường hoạt động trong 24 giờ gần nhất',
      preserveAspectRatio: 'none'
    });
    appendGrid(svg, maxValue);
    appendXLabels(svg, buckets);
    appendSeries(svg, buckets, 'visits', 'is-visits', 'Lượt truy cập', maxValue);
    appendSeries(svg, buckets, 'meetingsStarted', 'is-meetings', 'Cuộc họp bắt đầu', maxValue);
    root.append(svg);
    root.dataset.chartState = 'ready';
    rendered = true;
  }

  function destroy() {
    root.replaceChildren();
    delete root.dataset.chartState;
    rendered = false;
  }

  return Object.freeze({
    render,
    destroy,
    isRendered: () => rendered
  });
}
