require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const groupChatId = process.env.GROUP_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });
const userRequests = {};
let tickets = {};
let ticketCounter = 1;

// ===== Вспомогательные функции =====
async function getInviteLink() {
    try {
        return await bot.exportChatInviteLink(groupChatId);
    } catch (err) {
        console.error('Ошибка получения ссылки:', err);
        return null;
    }
}

async function isUserInGroup(userId) {
    try {
        const member = await bot.getChatMember(groupChatId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch {
        return false;
    }
}

// ===== /start =====
bot.onText(/^\/start$/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    const id = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[id]) {
        userRequests[id] = {
            acknowledgedRules: false,
            blocked: false,
            timestamp: 0,
            ticketTimestamp: 0,
            selectedAction: null,
            userId: id,
            username
        };
    }

    const user = userRequests[id];

    const keyboard = user.acknowledgedRules
        ? {
            inline_keyboard: [
                [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                [{ text: '🎫 Отправить тикет с жалобой', callback_data: 'menu_ticket' }]
            ]
        }
        : {
            inline_keyboard: [
                [{ text: '📖 Ознакомиться с правилами', url: 'https://telegra.ph/Pravila-nashej-gruppy-10-01' }],
                [{ text: '✅ Ознакомился', callback_data: 'ack_rules' }]
            ]
        };

    await bot.sendMessage(id, `👋 Привет, ${username}! Выберите действие:`, { reply_markup: keyboard });
});

// ===== /getchatid =====
bot.onText(/^\/getchatid$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Chat ID: ${msg.chat.id}`);
});

// ===== /ticket =====
bot.onText(/^\/ticket(?:\s(.+))?$/, async (msg, match) => {
    if (msg.chat.type !== 'private') return;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[userId]) userRequests[userId] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, userId, username };
    const user = userRequests[userId];

    if (!user.acknowledgedRules) return bot.sendMessage(userId, '⚠️ Сначала ознакомьтесь с правилами через /start.');

    const now = Date.now();
    if (user.ticketTimestamp && now - user.ticketTimestamp < 60000) {
        const remaining = Math.ceil((60000 - (now - user.ticketTimestamp)) / 1000);
        return bot.sendMessage(userId, `⏱ Подождите ${remaining} секунд перед новым тикетом.`);
    }

    const subscribed = await isUserInGroup(userId);
    if (!subscribed) {
        const inviteLink = await getInviteLink();
        return bot.sendMessage(userId, '📌 Подпишитесь на группу, чтобы отправить тикет.', {
            reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
        });
    }

    let text = match[1]?.trim() || msg.caption || msg.text || '';
    let contentType = null;
    let content = null;

    if (msg.photo) { contentType = 'photo'; content = msg.photo.at(-1).file_id; }
    else if (msg.video) { contentType = 'video'; content = msg.video.file_id; }
    else if (msg.document) { contentType = 'document'; content = msg.document.file_id; }
    else if (msg.voice) { contentType = 'voice'; content = msg.voice.file_id; }
    else if (text) { contentType = 'text'; content = text; }
    else return bot.sendMessage(userId, '⚠️ Пожалуйста, отправьте текст или медиа.');

    const ticketId = ticketCounter++;
    tickets[ticketId] = { userId, username, text, contentType, content };
    user.ticketTimestamp = now;

    bot.sendMessage(userId, `✅ Ваш тикет #${ticketId} отправлен администрации.`);

    const caption = `📩 *Новый тикет #${ticketId}*\n👤 ${username} (${userId})\n💬 ${text}\n\nДля ответа: /aticket ${ticketId} <текст>`;
    switch (contentType) {
        case 'photo': bot.sendPhoto(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'video': bot.sendVideo(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'document': bot.sendDocument(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'voice': bot.sendVoice(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        default: bot.sendMessage(adminChatId, caption, { parse_mode: 'Markdown' });
    }
});

// ===== /aticket =====
bot.onText(/^\/aticket (\d+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== adminChatId.toString()) return;

    const ticketId = parseInt(match[1]);
    const replyText = match[2].trim();

    if (!tickets[ticketId]) return bot.sendMessage(adminChatId, '❌ Тикет не найден.');
    const { userId, username } = tickets[ticketId];

    bot.sendMessage(userId, `📩 *Ответ администрации на ваш тикет #${ticketId}:*\n${replyText}`, { parse_mode: 'Markdown' });
    bot.sendMessage(adminChatId, `✅ Ответ отправлен пользователю ${username} (${userId}) на тикет #${ticketId}.`);
    delete tickets[ticketId];
});

// ===== /tickets =====
bot.onText(/^\/tickets$/, (msg) => {
    if (msg.chat.id.toString() !== adminChatId.toString()) return;
    if (!Object.keys(tickets).length) return bot.sendMessage(adminChatId, '📭 Нет активных тикетов.');

    let list = '*Список активных тикетов:*\n\n';
    for (const id in tickets) {
        const t = tickets[id];
        list += `#${id} — ${t.username} (${t.userId})\n💬 ${t.text}\n\n`;
    }
    bot.sendMessage(adminChatId, list, { parse_mode: 'Markdown' });
});

// ===== Callback кнопки =====
bot.on('callback_query', async (query) => {
    const id = query.from.id;
    const user = userRequests[id] ||= {
        acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, selectedAction: null,
        userId: id, username: query.from.username ? `@${query.from.username}` : query.from.first_name
    };

    if (query.data === 'ack_rules') {
        user.acknowledgedRules = true;
        return bot.sendMessage(id, '✅ Отлично! Теперь вы можете отправлять запросы и тикеты.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                    [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
                ]
            }
        });
    }

    if (!user.acknowledgedRules) return bot.answerCallbackQuery(query.id, { text: 'Ознакомьтесь с правилами.' });

    if (query.data === 'menu_request') {
        user.selectedAction = 'request';
        return bot.sendMessage(id, '📨 Теперь отправьте сообщение (текст, фото, видео, документ) для запроса.');
    }

    if (query.data === 'menu_ticket') {
        user.selectedAction = 'ticket';
        return bot.sendMessage(id, '🎫 Используйте /ticket <текст> для создания тикета.');
    }
});

// ===== Обработка сообщений после выбора “Отправить запрос” =====
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const userId = msg.from.id;
    const user = userRequests[userId];
    if (!user || user.blocked) return;
    if (msg.text && msg.text.startsWith('/')) return;
    if (user.selectedAction !== 'request') return;

    const subscribed = await isUserInGroup(userId);
    if (!subscribed) {
        const inviteLink = await getInviteLink();
        return bot.sendMessage(userId, '📌 Подпишитесь на группу, чтобы отправить запрос.', {
            reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
        });
    }

    const now = Date.now();
    if (user.timestamp && now - user.timestamp < 180000) {
        const wait = Math.ceil((180000 - (now - user.timestamp)) / 1000);
        return bot.sendMessage(userId, `⏱ Подождите ${wait} секунд перед новым запросом.`);
    }

    user.timestamp = now;

    let contentType, content, text = msg.caption || msg.text || '';
    if (msg.photo) { contentType = 'photo'; content = msg.photo.at(-1).file_id; }
    else if (msg.video) { contentType = 'video'; content = msg.video.file_id; }
    else if (msg.document) { contentType = 'document'; content = msg.document.file_id; }
    else if (msg.voice) { contentType = 'voice'; content = msg.voice.file_id; }
    else { contentType = 'text'; content = text; }

    const caption = `📨 *Новый запрос*\n👤 ${user.username} (${userId})\n💬 ${text || '(без текста)'}`;
    switch (contentType) {
        case 'photo': bot.sendPhoto(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'video': bot.sendVideo(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'document': bot.sendDocument(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        case 'voice': bot.sendVoice(adminChatId, content, { caption, parse_mode: 'Markdown' }); break;
        default: bot.sendMessage(adminChatId, caption, { parse_mode: 'Markdown' });
    }

    await bot.sendMessage(userId, '✅ Ваш запрос отправлен администрации.');
    user.selectedAction = null;
});