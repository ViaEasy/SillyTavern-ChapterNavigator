const EXTENSION_NAME = 'Message Navigator';
const ROOT_ID = 'chapter-navigator';
const LAUNCHER_ID = 'chapter-navigator-launcher';
const MESSAGE_PREVIEW_LIMIT = 72;
const POSITION_STORAGE_KEY = 'chapter-navigator-launcher-position';
const OPEN_STORAGE_KEY = 'chapter-navigator-panel-open';

let root;
let launcher;
let prevButton;
let nextButton;
let messageSelect;
let jumpInput;
let jumpButton;
let counter;
let emptyHint;
let chatObserver;
let updateTimer;
let cachedMessages = [];
let cachedSignature = '';
let currentMessageIndex = -1;
let currentMessageId = -1;
let eventsBound = false;
let isPanelOpen = false;
let dragState = null;
let suppressLauncherClick = false;
const cleanupCallbacks = [];

function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? {};
}

function getChatElement() {
    return document.getElementById('chat');
}

function getMessageElementById(messageId) {
    return document.querySelector(`.mes[mesid="${messageId}"]`);
}

function getLoadedMessageIds() {
    return Array.from(document.querySelectorAll('#chat .mes[mesid]'))
        .map(message => Number(message.getAttribute('mesid')))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
}

function normalizeText(text) {
    return String(text ?? '').replace(/[ \t\u3000]+/g, ' ').trim();
}

function getMessageText(message) {
    if (!message) {
        return '';
    }

    if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id)) {
        return String(message.swipes[message.swipe_id] ?? message.mes ?? '');
    }

    return String(message.mes ?? '');
}

function getMessagePreview(message, index) {
    const name = normalizeText(message?.name) || (message?.is_user ? 'User' : 'AI');
    const firstLine = String(getMessageText(message))
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => normalizeText(line))
        .find(Boolean) || '(空消息)';
    const clipped = firstLine.length > MESSAGE_PREVIEW_LIMIT
        ? `${firstLine.slice(0, MESSAGE_PREVIEW_LIMIT)}...`
        : firstLine;

    return `${index + 1}. ${name}: ${clipped}`;
}

function getVisibleAnchorMessageId() {
    const chat = getChatElement();
    if (!chat) {
        return -1;
    }

    const messages = Array.from(chat.querySelectorAll('.mes[mesid]'));
    if (!messages.length) {
        return -1;
    }

    const chatRect = chat.getBoundingClientRect();
    const anchorY = chatRect.top + Math.min(220, Math.max(80, chatRect.height * 0.35));
    let bestId = Number(messages[0].getAttribute('mesid'));

    for (const message of messages) {
        const rect = message.getBoundingClientRect();
        const id = Number(message.getAttribute('mesid'));

        if (!Number.isFinite(id)) {
            continue;
        }

        if (rect.top <= anchorY) {
            bestId = id;
        }

        if (rect.bottom >= anchorY) {
            return id;
        }
    }

    return bestId;
}

function makeSignature(chatLog) {
    return chatLog
        .map((message, index) => `${index}:${message?.name ?? ''}:${getMessageText(message).slice(0, 120)}`)
        .join('|');
}

function collectMessages() {
    const context = getContext();
    const chatLog = Array.isArray(context.chat) ? context.chat : [];
    const signature = makeSignature(chatLog);

    if (signature === cachedSignature) {
        return cachedMessages;
    }

    cachedSignature = signature;
    cachedMessages = chatLog.map((message, index) => ({
        id: index,
        label: getMessagePreview(message, index),
    }));

    return cachedMessages;
}

function clampNumber(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

function getSavedLauncherPosition() {
    try {
        const saved = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY) || 'null');
        if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) {
            return {
                left: saved.left,
                top: saved.top,
            };
        }
    } catch {
        localStorage.removeItem(POSITION_STORAGE_KEY);
    }

    return {
        left: window.innerWidth - 76,
        top: window.innerHeight - 160,
    };
}

function applyLauncherPosition(position) {
    if (!launcher) {
        return;
    }

    const width = launcher.offsetWidth || 52;
    const height = launcher.offsetHeight || 52;
    const nextPosition = {
        left: clampNumber(position.left, 8, window.innerWidth - width - 8),
        top: clampNumber(position.top, 8, window.innerHeight - height - 8),
    };

    launcher.style.left = `${nextPosition.left}px`;
    launcher.style.top = `${nextPosition.top}px`;
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(nextPosition));
    positionPanel();
}

function positionPanel() {
    if (!root || !launcher) {
        return;
    }

    const launcherRect = launcher.getBoundingClientRect();
    const panelWidth = root.offsetWidth || 260;
    const panelHeight = root.offsetHeight || 250;
    const gap = 10;
    const preferLeft = launcherRect.left + launcherRect.width + gap + panelWidth > window.innerWidth;
    const preferTop = launcherRect.top + panelHeight > window.innerHeight;
    const left = preferLeft
        ? launcherRect.left - panelWidth - gap
        : launcherRect.right + gap;
    const top = preferTop
        ? launcherRect.bottom - panelHeight
        : launcherRect.top;

    root.style.left = `${clampNumber(left, 8, window.innerWidth - panelWidth - 8)}px`;
    root.style.top = `${clampNumber(top, 8, window.innerHeight - panelHeight - 8)}px`;
}

function setPanelOpen(open) {
    isPanelOpen = open;
    root.hidden = !isPanelOpen;
    launcher.classList.toggle('is-open', isPanelOpen);
    launcher.setAttribute('aria-expanded', String(isPanelOpen));
    localStorage.setItem(OPEN_STORAGE_KEY, isPanelOpen ? '1' : '0');

    if (isPanelOpen) {
        positionPanel();
        scheduleUpdate();
    }
}

function togglePanel() {
    setPanelOpen(!isPanelOpen);
}

function getCurrentMessageIndex(messages = collectMessages()) {
    if (!messages.length) {
        return -1;
    }

    const anchorMessageId = getVisibleAnchorMessageId();
    if (anchorMessageId < 0) {
        return 0;
    }

    let index = 0;
    for (let i = 0; i < messages.length; i += 1) {
        if (messages[i].id <= anchorMessageId) {
            index = i;
        } else {
            break;
        }
    }

    return index;
}

function updateMessageSelect(messages) {
    const optionsSignature = messages.map(message => `${message.id}:${message.label}`).join('|');

    if (messageSelect.dataset.signature === optionsSignature) {
        return;
    }

    messageSelect.dataset.signature = optionsSignature;
    messageSelect.innerHTML = '';

    for (let i = 0; i < messages.length; i += 1) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = messages[i].label;
        messageSelect.appendChild(option);
    }
}

function updateUi() {
    const messages = collectMessages();
    const loadedMessageIds = getLoadedMessageIds();
    currentMessageId = getVisibleAnchorMessageId();
    const hasMessages = messages.length > 0 || loadedMessageIds.length > 0 || currentMessageId >= 0;

    root.classList.toggle('is-empty', !hasMessages);
    prevButton.disabled = !hasMessages;
    nextButton.disabled = !hasMessages;
    messageSelect.disabled = !messages.length;
    emptyHint.hidden = hasMessages;

    if (!hasMessages) {
        counter.textContent = '0 / 0';
        return;
    }

    updateMessageSelect(messages);
    currentMessageIndex = getCurrentMessageIndex(messages);
    if (messages.length) {
        messageSelect.value = String(currentMessageIndex);
        jumpInput.max = String(messages.length);
        jumpInput.placeholder = `1-${messages.length}`;
    } else {
        jumpInput.removeAttribute('max');
        jumpInput.placeholder = '消息序号';
    }

    const displayId = currentMessageId >= 0
        ? currentMessageId + 1
        : currentMessageIndex + 1;
    counter.textContent = messages.length > displayId
        ? `${displayId} / ${messages.length}`
        : `当前 ${displayId}`;

    prevButton.disabled = currentMessageId <= 0 && currentMessageIndex <= 0;
    nextButton.disabled = false;
    prevButton.title = currentMessageIndex > 0
        ? `上一条：${messages[currentMessageIndex - 1].label}`
        : '已经是第一条';
    nextButton.title = currentMessageIndex < messages.length - 1
        ? `下一条：${messages[currentMessageIndex + 1].label}`
        : '跳到下一条聊天记录';
    jumpInput.value = displayId > 0 ? String(displayId) : '';
    jumpButton.disabled = !hasMessages;
    positionPanel();
}

function scheduleUpdate() {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(updateUi, 80);
}

function highlightMessage(messageId) {
    const element = getMessageElementById(messageId);
    if (!element) {
        return;
    }

    element.classList.remove('chapter-navigator-flash');
    void element.offsetWidth;
    element.classList.add('chapter-navigator-flash');
    setTimeout(() => element.classList.remove('chapter-navigator-flash'), 1600);
}

function directScrollToMessage(messageId) {
    const element = getMessageElementById(messageId);

    if (!element) {
        return false;
    }

    element.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
    });
    highlightMessage(messageId);
    return true;
}

async function jumpToMessage(messageId) {
    const context = getContext();
    const command = `/chat-jump ${messageId}`;

    try {
        if (typeof context.executeSlashCommandsWithOptions === 'function') {
            await context.executeSlashCommandsWithOptions(command);
        } else if (typeof context.executeSlashCommands === 'function') {
            await context.executeSlashCommands(command);
        } else if (!directScrollToMessage(messageId)) {
            console.warn(`[${EXTENSION_NAME}] Could not find /chat-jump or message element`, messageId);
        }
    } catch (error) {
        console.warn(`[${EXTENSION_NAME}] /chat-jump failed, falling back to direct scroll`, error);
        directScrollToMessage(messageId);
    }

    let retries = 0;
    const waitForElement = () => {
        if (directScrollToMessage(messageId) || retries >= 20) {
            scheduleUpdate();
            return;
        }

        retries += 1;
        setTimeout(waitForElement, 100);
    };

    waitForElement();
}

function jumpToMessageIndex(index) {
    const messages = collectMessages();
    const nextIndex = Math.max(0, Math.min(index, messages.length - 1));
    const target = messages[nextIndex];

    if (!target) {
        return;
    }

    jumpToMessage(target.id);
}

function jumpToNumber(rawValue) {
    const number = Number(rawValue);
    if (!Number.isFinite(number) || number < 1) {
        return;
    }

    const messages = collectMessages();
    const max = messages.length || number;
    const messageNumber = Math.floor(clampNumber(number, 1, max));

    if (messages.length) {
        jumpToMessage(messages[messageNumber - 1].id);
        return;
    }

    jumpToMessage(messageNumber - 1);
}

function jumpByOffset(offset) {
    const anchorMessageId = getVisibleAnchorMessageId();

    if (anchorMessageId >= 0) {
        jumpToMessage(Math.max(0, anchorMessageId + offset));
        return;
    }

    const messages = collectMessages();
    const index = getCurrentMessageIndex(messages);
    if (index < 0) {
        return;
    }

    jumpToMessageIndex(index + offset);
}

function createIcon(className) {
    const icon = document.createElement('i');
    icon.className = className;
    icon.setAttribute('aria-hidden', 'true');
    return icon;
}

function createButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.append(createIcon(className.includes('prev') ? 'fa-solid fa-chevron-up' : 'fa-solid fa-chevron-down'));
    button.append(document.createElement('span'));
    button.querySelector('span').textContent = label;
    button.addEventListener('click', onClick);
    return button;
}

function createLauncher() {
    launcher = document.createElement('button');
    launcher.id = LAUNCHER_ID;
    launcher.type = 'button';
    launcher.title = '打开消息导航，拖动可移动位置';
    launcher.setAttribute('aria-controls', ROOT_ID);
    launcher.setAttribute('aria-expanded', 'false');
    launcher.append(createIcon('fa-solid fa-location-arrow'));
    launcher.append(document.createElement('span'));
    launcher.querySelector('span').textContent = '导航';
    launcher.addEventListener('click', () => {
        if (suppressLauncherClick) {
            suppressLauncherClick = false;
            return;
        }

        togglePanel();
    });
    launcher.addEventListener('pointerdown', handleLauncherPointerDown);
    document.body.appendChild(launcher);
    requestAnimationFrame(() => applyLauncherPosition(getSavedLauncherPosition()));
}

function handleLauncherPointerDown(event) {
    if (event.button !== 0) {
        return;
    }

    const rect = launcher.getBoundingClientRect();
    dragState = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        left: rect.left,
        top: rect.top,
        moved: false,
    };
    launcher.setPointerCapture(event.pointerId);
    launcher.classList.add('is-dragging');
}

function handleLauncherPointerMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (Math.abs(dx) + Math.abs(dy) > 4) {
        dragState.moved = true;
    }

    applyLauncherPosition({
        left: dragState.left + dx,
        top: dragState.top + dy,
    });
}

function handleLauncherPointerUp(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    const moved = dragState.moved;
    if (launcher.hasPointerCapture(event.pointerId)) {
        launcher.releasePointerCapture(event.pointerId);
    }
    launcher.classList.remove('is-dragging');
    dragState = null;

    if (moved) {
        suppressLauncherClick = true;
        setTimeout(() => {
            suppressLauncherClick = false;
        }, 0);
    }
}

function cancelLauncherDrag() {
    dragState = null;
    launcher?.classList.remove('is-dragging');
}

function handleLauncherPointerCancel(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
    }

    if (launcher.hasPointerCapture(event.pointerId)) {
        launcher.releasePointerCapture(event.pointerId);
    }

    cancelLauncherDrag();
    setTimeout(() => {
        suppressLauncherClick = false;
    }, 0);
}

function createUi() {
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(LAUNCHER_ID)?.remove();

    root = document.createElement('div');
    root.id = ROOT_ID;
    root.hidden = true;

    const title = document.createElement('div');
    title.className = 'chapter-navigator-title';
    title.textContent = '消息导航';

    prevButton = createButton('上一条', 'chapter-navigator-button chapter-navigator-prev', () => jumpByOffset(-1));
    nextButton = createButton('下一条', 'chapter-navigator-button chapter-navigator-next', () => jumpByOffset(1));

    messageSelect = document.createElement('select');
    messageSelect.className = 'chapter-navigator-select';
    messageSelect.title = '跳转到指定消息';
    messageSelect.addEventListener('change', () => jumpToMessageIndex(Number(messageSelect.value)));

    const jumpRow = document.createElement('form');
    jumpRow.className = 'chapter-navigator-jump';
    jumpRow.addEventListener('submit', (event) => {
        event.preventDefault();
        jumpToNumber(jumpInput.value);
    });

    jumpInput = document.createElement('input');
    jumpInput.className = 'chapter-navigator-jump-input';
    jumpInput.type = 'number';
    jumpInput.min = '1';
    jumpInput.step = '1';
    jumpInput.inputMode = 'numeric';
    jumpInput.title = '输入消息序号';

    jumpButton = document.createElement('button');
    jumpButton.className = 'chapter-navigator-jump-button';
    jumpButton.type = 'submit';
    jumpButton.textContent = '跳转';
    jumpRow.append(jumpInput, jumpButton);

    counter = document.createElement('div');
    counter.className = 'chapter-navigator-counter';
    counter.textContent = '0 / 0';

    emptyHint = document.createElement('div');
    emptyHint.className = 'chapter-navigator-empty';
    emptyHint.textContent = '没有聊天记录';
    emptyHint.hidden = true;

    root.append(title, prevButton, messageSelect, nextButton, jumpRow, counter, emptyHint);
    document.body.appendChild(root);
    createLauncher();
    setPanelOpen(localStorage.getItem(OPEN_STORAGE_KEY) === '1');
}

function bindEvents() {
    if (eventsBound) {
        return;
    }

    eventsBound = true;
    const context = getContext();
    const chat = getChatElement();

    const scrollOptions = { passive: true };
    chat?.addEventListener('scroll', scheduleUpdate, scrollOptions);
    window.addEventListener('scroll', scheduleUpdate, scrollOptions);
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('pointermove', handleLauncherPointerMove);
    window.addEventListener('pointerup', handleLauncherPointerUp);
    window.addEventListener('pointercancel', handleLauncherPointerCancel);
    cleanupCallbacks.push(() => chat?.removeEventListener('scroll', scheduleUpdate));
    cleanupCallbacks.push(() => window.removeEventListener('scroll', scheduleUpdate));
    cleanupCallbacks.push(() => window.removeEventListener('resize', scheduleUpdate));
    cleanupCallbacks.push(() => window.removeEventListener('pointermove', handleLauncherPointerMove));
    cleanupCallbacks.push(() => window.removeEventListener('pointerup', handleLauncherPointerUp));
    cleanupCallbacks.push(() => window.removeEventListener('pointercancel', handleLauncherPointerCancel));

    if (chat) {
        chatObserver = new MutationObserver(scheduleUpdate);
        chatObserver.observe(chat, {
            childList: true,
            subtree: true,
        });
        cleanupCallbacks.push(() => chatObserver?.disconnect());
    }

    if (context.eventSource && context.event_types) {
        const { eventSource, event_types } = context;
        const eventHandler = () => {
            cachedSignature = '';
            scheduleUpdate();
        };
        const events = [
            event_types.APP_READY,
            event_types.CHAT_CHANGED,
            event_types.MESSAGE_RECEIVED,
            event_types.MESSAGE_SENT,
            event_types.MESSAGE_UPDATED,
            event_types.MESSAGE_DELETED,
            event_types.GROUP_UPDATED,
        ].filter(Boolean);

        for (const eventName of events) {
            eventSource.on(eventName, eventHandler);
            cleanupCallbacks.push(() => eventSource.removeListener?.(eventName, eventHandler));
        }
    }
}

function unbindEvents() {
    for (const cleanup of cleanupCallbacks.splice(0)) {
        cleanup();
    }

    eventsBound = false;
}

(function init() {
    createUi();
    bindEvents();
    scheduleUpdate();
})();

export function onDisable() {
    unbindEvents();
    cancelLauncherDrag();
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(LAUNCHER_ID)?.remove();
}

export function onEnable() {
    createUi();
    bindEvents();
    scheduleUpdate();
}
