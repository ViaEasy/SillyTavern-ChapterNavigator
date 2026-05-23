const EXTENSION_NAME = 'Chapter Navigator';
const ROOT_ID = 'chapter-navigator';
const CHAPTER_TITLE_LIMIT = 96;
const CN_NUM = '零〇○Ｏ一二两三四五六七八九十百千万亿壹贰叁肆伍陆柒捌玖拾佰仟0-9';
const CHAPTER_TITLE_RE = new RegExp(
    '^\\s*(?:'
    + `第[${CN_NUM}]+[章节回卷部集篇]\\s*[^\\n]{0,${CHAPTER_TITLE_LIMIT}}`
    + '|'
    + `[卷部集篇][${CN_NUM}]+\\s*[^\\n]{0,${CHAPTER_TITLE_LIMIT}}`
    + '|'
    + `(?:chapter|chap\\.?)\\s*\\d+\\s*(?:[:：.\\-])?\\s*[^\\n]{0,${CHAPTER_TITLE_LIMIT}}`
    + '|'
    + `(?:序章|楔子|引子|前言|尾声|后记|後記|番外[${CN_NUM}]*)\\s*[^\\n]{0,${CHAPTER_TITLE_LIMIT}}`
    + ')\\s*$',
    'i',
);

let root;
let prevButton;
let nextButton;
let chapterSelect;
let counter;
let emptyHint;
let chatObserver;
let updateTimer;
let cachedChapters = [];
let cachedSignature = '';
let currentChapterIndex = -1;
let eventsBound = false;
const cleanupCallbacks = [];

function getContext() {
    return globalThis.SillyTavern?.getContext?.() ?? {};
}

function getChatElement() {
    return document.getElementById('chat');
}

function normalizeTitle(title) {
    return String(title ?? '').replace(/[ \t\u3000]+/g, ' ').trim();
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

function extractChapterTitle(text) {
    const firstLine = String(text ?? '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map(line => normalizeTitle(line))
        .find(Boolean);

    if (!firstLine || firstLine.length > CHAPTER_TITLE_LIMIT + 20) {
        return '';
    }

    return CHAPTER_TITLE_RE.test(firstLine) ? firstLine : '';
}

function getMessageElementById(messageId) {
    return document.querySelector(`.mes[mesid="${messageId}"]`);
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
        .map((message, index) => `${index}:${getMessageText(message).slice(0, 120)}`)
        .join('|');
}

function collectChapters() {
    const context = getContext();
    const chatLog = Array.isArray(context.chat) ? context.chat : [];
    const signature = makeSignature(chatLog);

    if (signature === cachedSignature) {
        return cachedChapters;
    }

    cachedSignature = signature;
    cachedChapters = chatLog
        .map((message, index) => ({
            id: index,
            title: extractChapterTitle(getMessageText(message)),
        }))
        .filter(chapter => chapter.title);

    return cachedChapters;
}

function getCurrentChapterIndex(chapters = collectChapters()) {
    if (!chapters.length) {
        return -1;
    }

    const anchorMessageId = getVisibleAnchorMessageId();
    if (anchorMessageId < 0) {
        return 0;
    }

    let index = 0;
    for (let i = 0; i < chapters.length; i += 1) {
        if (chapters[i].id <= anchorMessageId) {
            index = i;
        } else {
            break;
        }
    }

    return index;
}

function updateChapterSelect(chapters) {
    const optionsSignature = chapters.map(chapter => `${chapter.id}:${chapter.title}`).join('|');

    if (chapterSelect.dataset.signature === optionsSignature) {
        return;
    }

    chapterSelect.dataset.signature = optionsSignature;
    chapterSelect.innerHTML = '';

    for (let i = 0; i < chapters.length; i += 1) {
        const option = document.createElement('option');
        option.value = String(i);
        option.textContent = `${i + 1}. ${chapters[i].title}`;
        chapterSelect.appendChild(option);
    }
}

function updateUi() {
    const chapters = collectChapters();
    const hasChapters = chapters.length > 0;

    root.classList.toggle('is-empty', !hasChapters);
    prevButton.disabled = !hasChapters;
    nextButton.disabled = !hasChapters;
    chapterSelect.disabled = !hasChapters;
    emptyHint.hidden = hasChapters;

    if (!hasChapters) {
        counter.textContent = '0 / 0';
        return;
    }

    updateChapterSelect(chapters);
    currentChapterIndex = getCurrentChapterIndex(chapters);
    chapterSelect.value = String(currentChapterIndex);
    counter.textContent = `${currentChapterIndex + 1} / ${chapters.length}`;
    prevButton.disabled = currentChapterIndex <= 0;
    nextButton.disabled = currentChapterIndex >= chapters.length - 1;
    prevButton.title = currentChapterIndex > 0
        ? `上一章：${chapters[currentChapterIndex - 1].title}`
        : '已经是第一章';
    nextButton.title = currentChapterIndex < chapters.length - 1
        ? `下一章：${chapters[currentChapterIndex + 1].title}`
        : '已经是最后一章';
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

function jumpToChapter(index) {
    const chapters = collectChapters();
    const nextIndex = Math.max(0, Math.min(index, chapters.length - 1));
    const target = chapters[nextIndex];

    if (!target) {
        return;
    }

    jumpToMessage(target.id);
}

function jumpByOffset(offset) {
    const chapters = collectChapters();
    const index = getCurrentChapterIndex(chapters);

    if (index < 0) {
        return;
    }

    jumpToChapter(index + offset);
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
    title.textContent = '章节导航';

    prevButton = createButton('上一章', 'chapter-navigator-button chapter-navigator-prev', () => jumpByOffset(-1));
    nextButton = createButton('下一章', 'chapter-navigator-button chapter-navigator-next', () => jumpByOffset(1));

    chapterSelect = document.createElement('select');
    chapterSelect.className = 'chapter-navigator-select';
    chapterSelect.title = '跳转到指定章节';
    chapterSelect.addEventListener('change', () => jumpToChapter(Number(chapterSelect.value)));

    counter = document.createElement('div');
    counter.className = 'chapter-navigator-counter';
    counter.textContent = '0 / 0';

    emptyHint = document.createElement('div');
    emptyHint.className = 'chapter-navigator-empty';
    emptyHint.textContent = '没识别到章节标题';
    emptyHint.hidden = true;

    root.append(title, prevButton, chapterSelect, nextButton, counter, emptyHint);
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
