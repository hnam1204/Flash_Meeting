import { createIcon, renderIcons, setIcon } from './ui/icons.js';
import { getParticipantRoleLabel, PARTICIPANT_ROLES } from './meeting-participants.js';
import { validateMeetingDisplayName } from './display-name.js';

export const PARTICIPANTS_PER_PAGE = 5;

function participantKey(participant) {
  return String(
    participant?.id
      || participant?.participantId
      || participant?.livekitIdentity
      || participant?.identity
      || ''
  ).trim();
}

function getInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words.at(-1)[0]}`.toUpperCase();
}

function isLiveTrack(track) {
  const mediaTrack = track?.mediaStreamTrack || track;
  return Boolean(mediaTrack && mediaTrack.readyState !== 'ended');
}

function hasLocalVideo(participant, stream) {
  return Boolean(participant?.cameraEnabled && isLiveTrack(stream?.getVideoTracks?.()[0]));
}

function getCameraTrack(participant) {
  return participant?.cameraTrack || participant?.cameraPublication?.track || null;
}

function hasRemoteVideo(participant) {
  return Boolean(participant?.cameraEnabled && isLiveTrack(getCameraTrack(participant)));
}

function makeElement(tagName, className = '') {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  return element;
}

function setParticipantIcon(target, name, label) {
  if (!target) return;
  setIcon(target, name, { label });
  target.setAttribute('aria-label', label);
}

function createTile(variant) {
  const tile = makeElement(variant === 'grid' ? 'article' : 'button', 'participant-tile');
  if (variant === 'grid') tile.classList.add('grid-tile');
  else tile.type = 'button';
  tile.setAttribute('role', 'listitem');

  const visual = makeElement('div', 'participant-visual');
  const video = makeElement('video', 'participant-video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.setAttribute('aria-hidden', 'true');
  const avatar = makeElement('span', 'participant-avatar');
  const reaction = makeElement('span', 'participant-reaction');
  reaction.hidden = true;
  reaction.setAttribute('aria-live', 'polite');
  visual.append(video, avatar, reaction);

  const topBadges = makeElement('div', 'participant-top-badges');
  const localBadge = makeElement('span', 'participant-local');
  localBadge.textContent = 'Bạn';
  const roleBadge = makeElement('span', 'participant-role-badge');
  const handBadge = makeElement('span', 'participant-hand');
  handBadge.append(createIcon('hand'));
  handBadge.setAttribute('aria-label', 'Đang giơ tay');
  const presenterBadge = makeElement('span', 'participant-presenter');
  presenterBadge.append(createIcon('screen-share'));
  presenterBadge.setAttribute('aria-label', 'Đang trình bày');
  topBadges.append(localBadge, roleBadge, handBadge, presenterBadge);

  const footer = makeElement('div', 'participant-footer');
  const name = makeElement('span', 'participant-name');
  const mediaState = makeElement('span', 'participant-media-state');
  const microphoneState = makeElement('span', 'participant-state');
  const cameraState = makeElement('span', 'participant-state');
  mediaState.append(microphoneState, cameraState);
  footer.append(name, mediaState);
  tile.append(visual, topBadges, footer);

  return {
    tile,
    visual,
    video,
    avatar,
    reaction,
    localBadge,
    roleBadge,
    handBadge,
    presenterBadge,
    name,
    microphoneState,
    cameraState,
    attachedTrack: null,
    participant: null,
    reactionTimer: 0,
    selectBound: false
  };
}

export function createParticipantGridController({
  gridElement,
  filmstripElement,
  paginationWrap,
  previousButton,
  nextButton,
  pageIndicator,
  summaryElement,
  getParticipants = () => [],
  getLocalStream = () => null,
  getLiveKit = () => null,
  getActiveParticipantId = () => '',
  getPresenterId = () => '',
  onSelectParticipant
} = {}) {
  const entries = new Map();
  const order = new Map();
  let nextOrder = 0;
  let currentPage = 0;
  let pageCount = 1;
  let lastMode = 'grid';
  let paginationLabel = null;

  function getOrderedParticipants() {
    const participants = getParticipants()
      .filter((participant) => participantKey(participant));
    const presentKeys = new Set(participants.map(participantKey));
    participants.forEach((participant) => {
      const key = participantKey(participant);
      if (!order.has(key)) order.set(key, nextOrder++);
    });
    [...order.keys()].forEach((key) => {
      if (!presentKeys.has(key)) order.delete(key);
    });
    return participants.slice().sort((left, right) => {
      if (left.local !== right.local) return left.local ? -1 : 1;
      return (order.get(participantKey(left)) ?? 0) - (order.get(participantKey(right)) ?? 0);
    });
  }

  function getEntry(participant, variant) {
    const key = participantKey(participant);
    let entry = entries.get(key);
    if (!entry) {
      entry = { key, grid: createTile('grid'), strip: createTile('strip') };
      entries.set(key, entry);
    }
    return variant === 'grid' ? entry.grid : entry.strip;
  }

  function detachVideo(entry) {
    if (!entry) return;
    entry.attachedTrack?.detach?.(entry.video);
    entry.video.srcObject = null;
    entry.attachedTrack = null;
  }

  function updateReaction(entry, participant) {
    const reaction = String(participant?.reaction || '');
    const expiresAt = Number(participant?.reactionExpiresAt || 0);
    const active = reaction && expiresAt > Date.now();
    entry.reaction.hidden = !active;
    entry.reaction.textContent = active ? reaction : '';
    if (entry.reactionTimer) window.clearTimeout(entry.reactionTimer);
    entry.reactionTimer = 0;
    if (active) {
      entry.reactionTimer = window.setTimeout(() => {
        if (entry.participant !== participant && Number(entry.participant?.reactionExpiresAt || 0) > Date.now()) return;
        entry.reaction.hidden = true;
        entry.reaction.textContent = '';
        entry.reactionTimer = 0;
      }, Math.max(0, expiresAt - Date.now()));
    }
  }

  function updateTile(entry, participant, variant) {
    const tile = entry.tile;
    const key = participantKey(participant);
    const localStream = getLocalStream();
    const activeId = String(getActiveParticipantId() || '');
    const presenterId = String(getPresenterId() || '');
    const localVideo = participant.local && hasLocalVideo(participant, localStream);
    const remoteVideo = !participant.local && hasRemoteVideo(participant);
    const showVideo = localVideo || remoteVideo;
    const cameraTrack = getCameraTrack(participant);
    const displayName = validateMeetingDisplayName(participant?.name);
    if (!displayName.valid) {
      tile.hidden = true;
      return;
    }
    tile.hidden = false;

    entry.participant = participant;
    tile.dataset.participantKey = key;
    tile.classList.toggle('is-local', Boolean(participant.local));
    tile.classList.toggle('is-speaking', Boolean(participant.speaking));
    tile.classList.toggle('is-active', participant.id === activeId);
    tile.classList.toggle('has-reaction', Boolean(participant.reaction && Number(participant.reactionExpiresAt) > Date.now()));
    tile.classList.toggle('has-camera', showVideo);
    tile.classList.toggle('camera-off', !participant.cameraEnabled);
    tile.setAttribute('aria-label', `${displayName.value}, micro ${participant.microphoneEnabled ? 'đang bật' : 'đang tắt'}, camera ${participant.cameraEnabled ? 'đang bật' : 'đang tắt'}${participant.local ? ', Bạn' : ''}`);

    entry.localBadge.hidden = !participant.local;
    const hasRoleBadge = [PARTICIPANT_ROLES.HOST, PARTICIPANT_ROLES.CO_HOST].includes(participant.role);
    entry.roleBadge.hidden = !hasRoleBadge;
    entry.roleBadge.textContent = hasRoleBadge ? getParticipantRoleLabel(participant.role) : '';
    entry.handBadge.hidden = !participant.handRaised;
    entry.presenterBadge.hidden = presenterId !== key && presenterId !== String(participant.id || '');
    entry.name.textContent = participant.local ? `${displayName.value} (Bạn)` : displayName.value;

    setParticipantIcon(
      entry.microphoneState,
      participant.microphoneEnabled ? 'mic' : 'mic-off',
      participant.microphoneEnabled ? 'Micro đang bật' : 'Micro đang tắt'
    );
    setParticipantIcon(
      entry.cameraState,
      participant.cameraEnabled ? 'video' : 'video-off',
      participant.cameraEnabled ? 'Camera đang bật' : 'Camera đang tắt'
    );
    entry.microphoneState.classList.toggle('is-off', !participant.microphoneEnabled);
    entry.cameraState.classList.toggle('is-off', !participant.cameraEnabled);
    entry.avatar.textContent = getInitials(displayName.value);
    entry.visual.classList.toggle('camera-off', !participant.cameraEnabled || !showVideo);
    entry.video.classList.toggle('is-local-video', Boolean(participant.local));
    entry.video.classList.toggle('is-remote-video', !participant.local);
    entry.video.hidden = !showVideo;
    entry.avatar.hidden = showVideo;

    if (!showVideo) {
      detachVideo(entry);
    } else if (localVideo) {
      if (entry.attachedTrack) detachVideo(entry);
      if (entry.video.srcObject !== localStream) entry.video.srcObject = localStream || null;
      entry.video.play?.().catch(() => {});
    } else if (cameraTrack && entry.attachedTrack !== cameraTrack) {
      detachVideo(entry);
      const attached = getLiveKit()?.attachRemoteTrack?.(participant.livekitIdentity, 'camera', entry.video);
      if (attached) entry.attachedTrack = cameraTrack;
      else {
        cameraTrack.attach?.(entry.video);
        entry.attachedTrack = cameraTrack;
      }
    }
    updateReaction(entry, participant);
    if (variant === 'strip' && !entry.selectBound) {
      tile.addEventListener('click', () => onSelectParticipant?.(entry.participant?.id));
      entry.selectBound = true;
    }
  }

  function clearRemovedEntries(participants) {
    const keys = new Set(participants.map(participantKey));
    [...entries.entries()].forEach(([key, entry]) => {
      if (keys.has(key)) return;
      window.clearTimeout(entry.grid.reactionTimer);
      window.clearTimeout(entry.strip.reactionTimer);
      detachVideo(entry.grid);
      detachVideo(entry.strip);
      entry.grid.tile.remove();
      entry.strip.tile.remove();
      entries.delete(key);
    });
  }

  function ensurePaginationLabel() {
    if (paginationLabel) return paginationLabel;
    paginationLabel = makeElement('span', 'participant-pagination-label');
    paginationLabel.setAttribute('aria-live', 'polite');
    return paginationLabel;
  }

  function renderContainer(container, items, variant) {
    if (!container) return;
    const visibleKeys = new Set(items.map(participantKey));
    entries.forEach((entry) => {
      if (!visibleKeys.has(entry.key)) detachVideo(entry[variant]);
    });
    const nodes = items.map((participant) => {
      const entry = getEntry(participant, variant);
      updateTile(entry, participant, variant);
      return entry.tile;
    });
    container.replaceChildren(...nodes);
    renderIcons(container);
  }

  function updatePagination(total, start, visible, mode) {
    const hasMultiplePages = pageCount > 1;
    const showStrip = mode === 'presentation' || (mode === 'speaker' && total > 1);
    const stripItems = mode === 'grid' ? [] : showStripItems(mode, visible);
    if (paginationWrap) {
      paginationWrap.hidden = mode === 'grid' ? !hasMultiplePages : !showStrip;
      paginationWrap.dataset.paginationMode = mode;
      paginationWrap.classList.toggle('has-pagination', hasMultiplePages);
    }
    if (filmstripElement) filmstripElement.dataset.count = String(stripItems.length);
    if (filmstripElement && mode === 'grid') {
      filmstripElement.replaceChildren(...(hasMultiplePages ? [ensurePaginationLabel()] : []));
      filmstripElement.hidden = !hasMultiplePages;
    } else if (filmstripElement) {
      filmstripElement.hidden = !showStrip;
    }
    if (previousButton) {
      previousButton.hidden = !hasMultiplePages;
      previousButton.disabled = currentPage <= 0;
    }
    if (nextButton) {
      nextButton.hidden = !hasMultiplePages;
      nextButton.disabled = currentPage >= pageCount - 1;
    }
    if (pageIndicator) {
      pageIndicator.hidden = !hasMultiplePages;
      pageIndicator.textContent = `${currentPage + 1} / ${pageCount}`;
    }
    if (summaryElement) {
      summaryElement.hidden = !hasMultiplePages;
      summaryElement.textContent = total ? `Hiển thị ${start + 1}–${start + visible.length} / ${total} thành viên` : '';
    }
    const label = ensurePaginationLabel();
    label.textContent = `${currentPage + 1} / ${pageCount}`;
  }

  function render({ mode = lastMode } = {}) {
    lastMode = mode;
    const participants = getOrderedParticipants();
    clearRemovedEntries(participants);
    pageCount = Math.max(1, Math.ceil(participants.length / PARTICIPANTS_PER_PAGE));
    currentPage = Math.min(Math.max(0, currentPage), pageCount - 1);
    const start = currentPage * PARTICIPANTS_PER_PAGE;
    const visible = participants.slice(start, start + PARTICIPANTS_PER_PAGE);

    entries.forEach((entry) => {
      if (mode === 'grid') detachVideo(entry.strip);
      else detachVideo(entry.grid);
    });

    if (gridElement) {
      gridElement.dataset.count = String(visible.length);
      gridElement.dataset.page = String(currentPage + 1);
      gridElement.hidden = mode !== 'grid';
      renderContainer(gridElement, mode === 'grid' ? visible : [], 'grid');
    }
    if (filmstripElement && mode !== 'grid') {
      renderContainer(filmstripElement, showStripItems(mode, visible), 'strip');
    }
    updatePagination(participants.length, start, visible, mode);
    return { participants, visible, currentPage, pageCount };
  }

  function showStripItems(mode, visible) {
    return mode === 'presentation' || mode === 'speaker' ? visible : [];
  }

  function setPage(nextPage) {
    currentPage = Math.min(Math.max(0, Number(nextPage) || 0), pageCount - 1);
    return currentPage;
  }

  function getPage() {
    return currentPage;
  }

  function destroy() {
    entries.forEach((entry) => {
      window.clearTimeout(entry.grid.reactionTimer);
      window.clearTimeout(entry.strip.reactionTimer);
      detachVideo(entry.grid);
      detachVideo(entry.strip);
    });
    entries.clear();
    order.clear();
    gridElement?.replaceChildren();
    filmstripElement?.replaceChildren();
  }

  return Object.freeze({ render, setPage, getPage, get pageCount() { return pageCount; }, destroy });
}
