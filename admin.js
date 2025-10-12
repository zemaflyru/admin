require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const groupChatId = process.env.GROUP_CHAT_ID;

const bot = new TelegramBot(token, { polling: true });
const userRequests = {};

// ===== Тикеты =====
let tickets = {};
let ticketCounter = 1;

// Получение ссылки на группу
async function getInviteLink() {
    try {
        const link = await bot.exportChatInviteLink(groupChatId);
        return link;
    } catch (err) {
        console.error('Ошибка получения ссылки на группу:', err);
        return null;
    }
}

// Проверка подписки пользователя
async function isUserInGroup(userId) {
    try {
        const member = await bot.getChatMember(groupChatId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch {
        return false;
    }
}

// ===== Команды =====

// /start
bot.onText(/^\/start$/, (msg) => {
    if (msg.chat.type !== 'private') return;
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[msg.from.id]) {
        userRequests[msg.from.id] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, userId: msg.from.id, username };
    }

    const userData = userRequests[msg.from.id];

    // Формируем клавиатуру в зависимости от того, ознакомился пользователь или нет
    const keyboard = userData.acknowledgedRules
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

    bot.sendMessage(chatId, `👋 Привет, ${username}! Выберите действие:`, { reply_markup: keyboard });
});

// Обработка меню
bot.on('callback_query', async (query) => {
    const id = query.from.id;
    if (!userRequests[id]) userRequests[id] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, userId: id };

    const userData = userRequests[id];

    if (query.data === 'ack_rules') {
        if (!userData.acknowledgedRules) {
            userData.acknowledgedRules = true;
            const keyboard = {
                inline_keyboard: [
                    [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                    [{ text: '🎫 Отправить тикет с жалобой', callback_data: 'menu_ticket' }]
                ]
            };
            await bot.sendMessage(id, '✅ Отлично! Теперь вы можете отправлять запросы и тикеты.', { reply_markup: keyboard });
        }
        return bot.answerCallbackQuery(query.id);
    }

    if (!userData.acknowledgedRules) {
        return bot.answerCallbackQuery(query.id, { text: 'Сначала ознакомьтесь с правилами.' });
    }

    // Сохраняем выбранное действие
    if (query.data === 'menu_request') {
        userData.selectedAction = 'request';
        await bot.sendMessage(id, '📨 Теперь отправьте сообщение для запроса (только текст/файл/фото/видео).');
        return bot.answerCallbackQuery(query.id);
    }
    if (query.data === 'menu_ticket') {
        userData.selectedAction = 'ticket';
        await bot.sendMessage(id, '🎫 Чтобы создать тикет, используйте команду:\n/ticket <текст>\n📌 Вы можете отправлять тикет раз в 1 минуту.');
        return bot.answerCallbackQuery(query.id);
    }
});

// /getchatid
bot.onText(/^\/getchatid$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Chat ID: ${msg.chat.id}`);
});

// Команда /ticket (текст + медиа)
bot.onText(/^\/ticket(?:\s(.+))?$/, async (msg, match) => {
    if (msg.chat.type !== 'private') return;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
    const userData = userRequests[userId];

    if (!userData.acknowledgedRules) {
        return bot.sendMessage(userId, '⚠️ Сначала ознакомьтесь с правилами командой /start.');
    }

    const now = Date.now();
    if (userData.ticketTimestamp && now - userData.ticketTimestamp < 60000) {
        const remaining = Math.ceil((60000 - (now - userData.ticketTimestamp)) / 1000);
        return bot.sendMessage(userId, `⏱ Подождите ${remaining} секунд перед новым тикетом.`);
    }

    const subscribed = await isUserInGroup(userId);
    if (!subscribed) {
        const inviteLink = await getInviteLink();
        return bot.sendMessage(userId, '📌 Подпишитесь на группу, чтобы отправить тикет.', {
            reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
        });
    }

    let text = (match && match[1]) ? match[1].trim() : '';
    let contentType = null;
    let content = null;

    // Проверяем есть ли медиа
    if (msg.photo) {
        contentType = 'photo';
        content = msg.photo[msg.photo.length - 1].file_id;
        if (!text && msg.caption) text = msg.caption;
    } else if (msg.video) {
        contentType = 'video';
        content = msg.video.file_id;
        if (!text && msg.caption) text = msg.caption;
    } else if (msg.document) {
        contentType = 'document';
        content = msg.document.file_id;
        if (!text && msg.caption) text = msg.caption;
    } else if (msg.voice) {
        contentType = 'voice';
        content = msg.voice.file_id;
    } else if (text) {
        contentType = 'text';
        content = text;
    } else {
        return bot.sendMessage(userId, '⚠️ Пожалуйста, отправьте текст или медиа для тикета.');
    }

    const ticketId = ticketCounter++;
    tickets[ticketId] = { userId, username, text, contentType, content, timestamp: now };
    userData.ticketTimestamp = now;

    bot.sendMessage(userId, `✅ Ваш тикет #${ticketId} отправлен администрации.`);

    const caption = `📩 *Новый тикет #${ticketId}*\n👤 ${username} (${userId})\n💬 ${text || '(без текста)'}\n\nДля ответа на тикет используйте команду: /aticket ${ticketId} <текст ответа>`;

    // Отправляем админам тикет с медиа
    switch (contentType) {
        case 'text':
            bot.sendMessage(adminChatId, caption, { parse_mode: 'Markdown' });
            break;
        case 'photo':
            bot.sendPhoto(adminChatId, content, { caption, parse_mode: 'Markdown' });
            break;
        case 'video':
            bot.sendVideo(adminChatId, content, { caption, parse_mode: 'Markdown' });
            break;
        case 'document':
            bot.sendDocument(adminChatId, content, { caption, parse_mode: 'Markdown' });
            break;
        case 'voice':
            bot.sendVoice(adminChatId, content, { caption, parse_mode: 'Markdown' });
            break;
    }
});

// Ответ на тикет администратора
bot.onText(/^\/aticket (\d+) (.+)/, (msg, match) => {
    if (msg.chat.id.toString() !== adminChatId.toString()) return;

    const ticketId = parseInt(match[1]);
    const replyText = match[2].trim();

    if (!tickets[ticketId]) return bot.sendMessage(adminChatId, '❌ Тикет не найден.');

    const { userId, username, contentType, content, text } = tickets[ticketId];

    // Отправляем ответ пользователю
    bot.sendMessage(userId, `📩 *Ответ администрации на ваш тикет #${ticketId}:*\n${replyText}`, { parse_mode: 'Markdown' });

    // Можно также переслать исходное медиа пользователю вместе с ответом (опционально)
    if (contentType && contentType !== 'text') {
        const forwardCaption = `📩 Ваш тикет #${ticketId} с медиа:`;
        switch (contentType) {
            case 'photo':
                bot.sendPhoto(userId, content, { caption: forwardCaption });
                break;
            case 'video':
                bot.sendVideo(userId, content, { caption: forwardCaption });
                break;
            case 'document':
                bot.sendDocument(userId, content, { caption: forwardCaption });
                break;
            case 'voice':
                bot.sendVoice(userId, content, { caption: forwardCaption });
                break;
        }
    }

    bot.sendMessage(adminChatId, `✅ Ответ отправлен пользователю ${username} (${userId}) на тикет #${ticketId}.`);

    delete tickets[ticketId];
});

// /tickets
bot.onText(/^\/tickets$/, (msg) => {
    if (msg.chat.id.toString() !== adminChatId.toString()) return;

    if (Object.keys(tickets).length === 0) return bot.sendMessage(adminChatId, '📭 Нет активных тикетов.');

    let list = '*Список активных тикетов:*\n\n';
    for (const id in tickets) {
        const t = tickets[id];
        list += `#${id} - ${t.username} (${t.userId})\n💬 ${t.text}\n\n`;
    }
    bot.sendMessage(adminChatId, list, { parse_mode: 'Markdown' });
});

// ===== Обработка сообщений пользователей для запросов =====
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    if (msg.text && msg.text.startsWith('/ticket')) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[userId]) userRequests[userId] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, selectedAction: null, userId, username };
    const userData = userRequests[userId];

    // Проверяем ознакомление с правилами
    if (!userData.acknowledgedRules) {
        return bot.sendMessage(chatId, '⚠️ Сначала ознакомьтесь с правилами командой /start.');
    }

    // Проверяем, выбрал ли пользователь действие
    if (!userData.selectedAction) {
        return bot.sendMessage(chatId, '⚠️ Сначала выберите действие из меню командой /start.');
    }

    // Проверка блокировки
    if (userData.blocked) return bot.sendMessage(chatId, '🚫 Вы заблокированы.');

    // Проверка подписки на группу
    const subscribed = await isUserInGroup(userId);
    if (!subscribed) {
        const inviteLink = await getInviteLink();
        return bot.sendMessage(chatId, '📌 Подпишитесь на группу, чтобы отправить запрос.', {
            reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
        });
    }

    // Проверка таймаута для запросов (3 минуты)
    const now = Date.now();
    if (userData.timestamp && now - userData.timestamp < 180000) {
        const remaining = Math.ceil((180000 - (now - userData.timestamp)) / 1000);
        return bot.sendMessage(chatId, `⏱ Подождите ${remaining} сек перед новым запросом.`);
    }
    userData.timestamp = now;
    userData.username = username;

    // Если выбрано "ticket", подсказываем команду /ticket и сбрасываем selectedAction
    if (userData.selectedAction === 'ticket') {
        userData.selectedAction = null;
        return bot.sendMessage(chatId, '🎫 Чтобы создать тикет, используйте команду:\n/ticket <текст>\n📌 Вы можете отправлять тикет раз в 1 минуту.');
    }

    // Если выбрано "request", продолжаем обработку запроса
    if (userData.selectedAction === 'request') {
        let contentType = null;
        let content = null;
        if (msg.text) contentType = 'text', content = msg.text;
        else if (msg.photo) contentType = 'photo', content = msg.photo[msg.photo.length - 1].file_id;
        else if (msg.video) contentType = 'video', content = msg.video.file_id;
        else if (msg.document) contentType = 'document', content = msg.document.file_id;
        else if (msg.voice) contentType = 'voice', content = msg.voice.file_id;
        else return bot.sendMessage(chatId, '⚠️ Тип файла не поддерживается.');

        userData.contentType = contentType;
        userData.content = content;
        userData.text = msg.caption || msg.text || '';

        // Клавиатура для админского чата без кнопки редактировать
        const keyboard = {
            inline_keyboard: [
                [{ text: '✅ Опубликовать', callback_data: `publish_${userId}` }],
                [{ text: '❌ Отклонить', callback_data: `reject_${userId}` }],
                [{ text: userData.blocked ? '🔓 Разблокировать' : '⛔ Заблокировать', callback_data: `block_${userId}` }]
            ]
        };

        const messageText = `📨 *Новый запрос*\n👤 [${username}](tg://user?id=${userId})\n🆔 ${userId}\n💬 ${userData.text || '(без текста)'}`;
        if (contentType === 'text')
            bot.sendMessage(adminChatId, messageText, { parse_mode: 'Markdown', reply_markup: keyboard });
        else if (contentType === 'photo')
            bot.sendPhoto(adminChatId, content, { caption: messageText, parse_mode: 'Markdown', reply_markup: keyboard });
        else if (contentType === 'video')
            bot.sendVideo(adminChatId, content, { caption: messageText, parse_mode: 'Markdown', reply_markup: keyboard });
        else if (contentType === 'document')
            bot.sendDocument(adminChatId, content, { caption: messageText, parse_mode: 'Markdown', reply_markup: keyboard });
        else if (contentType === 'voice')
            bot.sendVoice(adminChatId, content, { caption: messageText, parse_mode: 'Markdown', reply_markup: keyboard });

        userData.selectedAction = null; // сброс после отправки запроса
        bot.sendMessage(chatId, '✅ Ваш запрос отправлен администрации.');
    }
});


// ===== Обработка callback кнопок =====
bot.on('callback_query', async (query) => {
    const [action, userId] = query.data.split('_');
    const userData = userRequests[userId];

    if (!userData) return bot.answerCallbackQuery(query.id, { text: 'Запрос не найден или уже обработан.' });

    switch (action) {
        case 'publish':
            switch (userData.contentType) {
                case 'text':
                    await bot.sendMessage(groupChatId, userData.text);
                    break;
                case 'photo':
                    await bot.sendPhoto(groupChatId, userData.content, { caption: userData.text || '' });
                    break;
                case 'video':
                    await bot.sendVideo(groupChatId, userData.content, { caption: userData.text || '' });
                    break;
                case 'document':
                    await bot.sendDocument(groupChatId, userData.content, { caption: userData.text || '' });
                    break;
                case 'voice':
                    await bot.sendVoice(groupChatId, userData.content, { caption: userData.text || '' });
                    break;
            }
            await bot.sendMessage(userData.userId, '✅ Ваш запрос опубликован.');
            delete userRequests[userId];
            bot.answerCallbackQuery(query.id, { text: 'Запрос опубликован.' });
            break;

        case 'reject':
            await bot.sendMessage(userData.userId, '❌ Ваш запрос отклонён.');
            delete userRequests[userId];
            bot.answerCallbackQuery(query.id, { text: 'Запрос отклонён.' });
            break;

        case 'block':
            // Меняем статус блокировки
            userData.blocked = !userData.blocked;
            await bot.sendMessage(
                userData.userId,
                userData.blocked
                    ? '🚫 Вы заблокированы и не можете отправлять запросы.'
                    : '🔓 Вы разблокированы и снова можете отправлять запросы.'
            );

            // Обновляем текст кнопки прямо в админском сообщении
            const newKeyboard = {
                inline_keyboard: [
                    [{ text: '✅ Опубликовать', callback_data: `publish_${userId}` }],
                    [{ text: '❌ Отклонить', callback_data: `reject_${userId}` }],
                    [{ text: userData.blocked ? '🔓 Разблокировать' : '⛔ Заблокировать', callback_data: `block_${userId}` }]
                ]
            };

            try {
                await bot.editMessageReplyMarkup(newKeyboard, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
            } catch (err) {
                console.error('Ошибка при обновлении кнопки:', err.message);
            }

            bot.answerCallbackQuery(query.id, { text: userData.blocked ? 'Пользователь заблокирован.' : 'Пользователь разблокирован.' });
            break;

        default:
            bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие.' });
    }
});

