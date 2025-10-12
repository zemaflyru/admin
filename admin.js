require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const groupChatId = process.env.GROUP_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });
const userRequests = {};

async function getInviteLink() {
    try {
        const link = await bot.exportChatInviteLink(groupChatId);
        return link;
    } catch (err) {
        console.error('Ошибка получения ссылки на группу:', err);
        return null;
    }
}

async function isUserInGroup(userId) {
    try {
        const member = await bot.getChatMember(groupChatId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch (err) {
        return false;
    }
}

bot.onText(/^\/start$/, (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[msg.from.id]) {
        userRequests[msg.from.id] = { acknowledgedRules: false, blocked: false, timestamp: 0, userId: msg.from.id, username };
    }

    bot.sendMessage(chatId, `Привет, ${username}! Перед отправкой запроса ознакомьтесь с правилами:`, {
        reply_markup: {
            inline_keyboard: [
                [
                    { text: 'Ознакомиться с правилами', url: 'https://telegra.ph/Pravila-nashej-gruppy-10-01' },
                    { text: 'Ознакомился', callback_data: 'ack_rules' }
                ]
            ]
        }
    });
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (msg.from.is_bot) return;
    if (chatId == adminChatId) return;

    if (!userRequests[userId]) {
        userRequests[userId] = { acknowledgedRules: false, blocked: false, timestamp: 0, userId, username };
    }

    const userData = userRequests[userId];

    if (userData.blocked) {
        return bot.sendMessage(chatId, 'Вы заблокированы и не можете отправлять запросы.');
    }

    if (!userData.acknowledgedRules) {
        return bot.sendMessage(chatId, 'Сначала ознакомьтесь с правилами:', {
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: 'Ознакомиться с правилами', url: 'https://telegra.ph/Pravila-nashej-gruppy-10-01' },
                        { text: 'Ознакомился', callback_data: 'ack_rules' }
                    ]
                ]
            }
        });
    }

    const subscribed = await isUserInGroup(userId);
    if (!subscribed) {
        const inviteLink = await getInviteLink();
        return bot.sendMessage(chatId, 'Вы должны подписаться на группу, чтобы отправить запрос.', {
            reply_markup: {
                inline_keyboard: [
                    [{ text: 'Подписаться', url: inviteLink || 'https://t.me/your_public_group_username' }]
                ]
            }
        });
    }

    // Ограничение по частоте: 3 минуты
    const now = Date.now();
    if (userData.timestamp && now - userData.timestamp < 180000) {
        const remaining = Math.ceil((180000 - (now - userData.timestamp)) / 1000);
        return bot.sendMessage(chatId, `Подождите ${remaining} секунд перед новым запросом.`);
    }

    userData.timestamp = now;
    userData.username = username;

    // Определяем тип сообщения
    let contentType = null;
    let content = null;

    if (msg.text) contentType = 'text', content = msg.text;
    else if (msg.photo) contentType = 'photo', content = msg.photo[msg.photo.length - 1].file_id;
    else if (msg.video) contentType = 'video', content = msg.video.file_id;
    else if (msg.document) contentType = 'document', content = msg.document.file_id;
    else if (msg.voice) contentType = 'voice', content = msg.voice.file_id;
    else return bot.sendMessage(chatId, 'Тип файла не поддерживается.');

    userData.contentType = contentType;
    userData.content = content;
    userData.text = msg.caption || msg.text || '';

    const keyboard = {
        inline_keyboard: [
            [
                { text: 'Опубликовать', callback_data: `publish_${userId}` },
                { text: 'Редактировать', callback_data: `edit_${userId}` },
                { text: 'Отклонить', callback_data: `reject_${userId}` },
                { text: userData.blocked ? 'Разблокировать' : 'Заблокировать', callback_data: `block_${userId}` }
            ]
        ]
    };

    if (contentType === 'text') bot.sendMessage(adminChatId, `Новый запрос от ${username} (${userId}):\n${userData.text}`, { reply_markup: keyboard });
    else if (contentType === 'photo') bot.sendPhoto(adminChatId, content, { caption: `Новый запрос от ${username} (${userId}): ${userData.text}`, reply_markup: keyboard });
    else if (contentType === 'video') bot.sendVideo(adminChatId, content, { caption: `Новый запрос от ${username} (${userId}): ${userData.text}`, reply_markup: keyboard });
    else if (contentType === 'document') bot.sendDocument(adminChatId, content, { caption: `Новый запрос от ${username} (${userId}): ${userData.text}`, reply_markup: keyboard });
    else if (contentType === 'voice') bot.sendVoice(adminChatId, content, { caption: `Новый запрос от ${username} (${userId}): ${userData.text}`, reply_markup: keyboard });

    bot.sendMessage(chatId, 'Ваш запрос отправлен администрации и ожидает решения.');
});

bot.on('callback_query', async (query) => {
    const [action, userId] = query.data.split('_');
    const userData = userRequests[userId];

    if (query.data === 'ack_rules') {
        userRequests[query.from.id] = userRequests[query.from.id] || {};
        userRequests[query.from.id].acknowledgedRules = true;
        return bot.sendMessage(query.from.id, 'Спасибо! Теперь вы можете отправлять запросы.');
    }

    if (!userData) return bot.answerCallbackQuery(query.id, { text: 'Запрос уже обработан или не найден.' });

    switch (action) {
        case 'publish':
            if (userData.contentType === 'text') bot.sendMessage(groupChatId, userData.text);
            else if (userData.contentType === 'photo') bot.sendPhoto(groupChatId, userData.content, { caption: userData.text });
            else if (userData.contentType === 'video') bot.sendVideo(groupChatId, userData.content, { caption: userData.text });
            else if (userData.contentType === 'document') bot.sendDocument(groupChatId, userData.content, { caption: userData.text });
            else if (userData.contentType === 'voice') bot.sendVoice(groupChatId, userData.content, { caption: userData.text });
            bot.sendMessage(userData.userId, 'Ваш запрос опубликован!');
            delete userRequests[userId];
            bot.answerCallbackQuery(query.id, { text: 'Опубликовано.' });
            break;
        case 'edit':
            bot.sendMessage(adminChatId, `Отправьте новый текст для запроса от ${userData.username} (${userId}):`);
            bot.once('message', (msg) => {
                if (msg.from.id != query.from.id) return;
                userData.text = msg.text || userData.text;
                bot.sendMessage(adminChatId, `Запрос от ${userData.username} обновлён.`);
            });
            bot.answerCallbackQuery(query.id);
            break;
        case 'reject':
            bot.sendMessage(userData.userId, 'Ваш запрос отклонён администрацией.');
            delete userRequests[userId];
            bot.answerCallbackQuery(query.id, { text: 'Отклонено.' });
            break;
        case 'block':
            userData.blocked = !userData.blocked;
            bot.sendMessage(userData.userId, userData.blocked
                ? 'Вы заблокированы и не можете отправлять запросы.'
                : 'Вас разблокировали. Теперь вы можете отправлять запросы.');
            bot.editMessageReplyMarkup({
                inline_keyboard: [
                    [
                        { text: 'Опубликовать', callback_data: `publish_${userId}` },
                        { text: 'Редактировать', callback_data: `edit_${userId}` },
                        { text: 'Отклонить', callback_data: `reject_${userId}` },
                        { text: userData.blocked ? 'Разблокировать' : 'Заблокировать', callback_data: `block_${userId}` }
                    ]
                ]
            }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
            bot.answerCallbackQuery(query.id, { text: userData.blocked ?
