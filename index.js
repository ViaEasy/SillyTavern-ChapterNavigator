const EXTENSION_NAME = 'Message Navigator';
const ROOT_ID = 'chapter-navigator';
const MESSAGE_PREVIEW_LIMIT = 72;

let root;
let prevButton;
let nextButton;
let messageSelect;
let counter;
let emptyHint;
let chatObserver;
let updateTimer;
let cachedMessages = [];
let cachedSignature = '';
let currentMessageIndex = -1;
let eventsBound = false;
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
    const hasMessages = messages.length > 0;

    root.classList.toggle('is-empty', !hasMessages);
    prevButton.disabled = !hasMessages;
    nextButton.disabled = !hasMessages;
    messageSelect.disabled = !hasMessages;
    emptyHint.hidden = hasMessages;

    if (!hasMessages) {
        counter.textContent = '0 / 0';
        return;
    }

    updateMessageSelect(messages);
    currentMessageIndex = getCurrentMessageIndex(messages);
    messageSelect.value = String(currentMessageIndex);
    counter.textContent = `${currentMessageIndex + 1} / ${messages.length}`;
    prevButton.disabled = currentMessageIndex <= 0;
    nextButton.disabled = currentMessageIndex >= messages.length - 1;
    prevButton.title = currentMessageIndex > 0
        ? `上一条：${messages[currentMessageIndex - 1].label}`
        : '已经是第一条';
    nextButton.title = currentMessageIndex < messages.length - 1
        ? `下一条：${messages[currentMessageIndex + 1].label}`
        : '已经是最后一条';
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

function jumpByOffset(offset) {
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

function createUi() {
    document.getElementById(ROOT_ID)?.remove();

    root = document.createElement('div');
    root.id = ROOT_ID;

    const title = document.createElement('div');
    title.className = 'chapter-navigator-title';
    title.textContent = '消息导航';

    prevButton = createButton('上一条', 'chapter-navigator-button chapter-navigator-prev', () => jumpByOffset(-1));
    nextButton = createButton('下一条', 'chapter-navigator-button chapter-navigator-next', () => jumpByOffset(1));

    messageSelect = document.createElement('select');
    messageSelect.className = 'chapter-navigator-select';
    messageSelect.title = '跳转到指定消息';
    messageSelect.addEventListener('change', () => jumpToMessageIndex(Number(messageSelect.value)));

    counter = document.createElement('div');
    counter.className = 'chapter-navigator-counter';
    counter.textContent = '0 / 0';

    emptyHint = document.createElement('div');
    emptyHint.className = 'chapter-navigator-empty';
    emptyHint.textContent = '没有聊天记录';
    emptyHint.hidden = true;

    root.append(title, prevButton, messageSelect, nextButton, counter, emptyHint);
    document.body.appendChild(root);
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
    cleanupCallbacks.push(() => chat?.removeEventListener('scroll', scheduleUpdate));
    cleanupCallbacks.push(() => window.removeEventListener('scroll', scheduleUpdate));
    cleanupCallbacks.push(() => window.removeEventListener('resize', scheduleUpdate));

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
    document.getElementById(ROOT_ID)?.remove();
}

export function onEnable() {
    createUi();
    bindEvents();
    scheduleUpdate();
}
