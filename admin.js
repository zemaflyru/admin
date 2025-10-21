require('dotenv').config();

// === SQLITE НАСТРОЙКА ===
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.DB_PATH || './bot_data.db');

// Создаём таблицу для админов
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS admins (
            user_id INTEGER PRIMARY KEY,
            username TEXT
        )
    `);
});

// Создаём таблицу для пользователей
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            blocked INTEGER DEFAULT 0,
            ticket_blocked INTEGER DEFAULT 0
        )
    `);
});

// Загружаем админов из БД при старте
let botAdmins = new Set();
db.all(`SELECT * FROM admins`, [], (err, rows) => {
    if (err) return console.error('Ошибка загрузки админов из БД:', err);
    rows.forEach(row => botAdmins.add(row.user_id));
    console.log(`✅ Загружено администраторов: ${rows.length}`);
});

// Добавляем главного админа, если его нет в БД
if (!botAdmins.has(774756964)) {
    botAdmins.add(774756964);
    addAdminToDB(774756964, '@zoomflyru');
}

// Функция для добавления админа в БД
function addAdminToDB(userId, username) {
    db.run(
        `INSERT OR REPLACE INTO admins (user_id, username) VALUES (?, ?)`,
        [userId, username],
        err => {
            if (err) console.error('Ошибка при добавлении админа в БД:', err);
        }
    );
}

// Функция для удаления админа из БД
function removeAdminFromDB(userId) {
    db.run(`DELETE FROM admins WHERE user_id = ?`, [userId], err => {
        if (err) console.error('Ошибка при удалении админа из БД:', err);
    });
}

// ===== ФУНКЦИИ ДЛЯ ПОЛЬЗОВАТЕЛЕЙ =====

// Добавление или обновление пользователя в БД
function upsertUserToDB(user) {
    db.run(
        `INSERT INTO users (user_id, username, blocked, ticket_blocked)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            username = excluded.username,
            blocked = excluded.blocked,
            ticket_blocked = excluded.ticket_blocked`,
        [user.userId, user.username, user.blocked ? 1 : 0, user.ticketBlocked ? 1 : 0],
        err => {
            if (err) console.error('Ошибка сохранения пользователя в БД:', err);
        }
    );
}

// Загрузка всех пользователей из БД при старте
function loadUsersFromDB() {
    db.all(`SELECT * FROM users`, [], (err, rows) => {
        if (err) return console.error('Ошибка загрузки пользователей из БД:', err);
        rows.forEach(row => {
            userRequests[row.user_id] = {
                userId: row.user_id,
                username: row.username,
                blocked: !!row.blocked,
                ticketBlocked: !!row.ticket_blocked,
                acknowledgedRules: false,
                selectedAction: null,
                timestamp: 0,
                ticketTimestamp: 0
            };
        });
        console.log(`✅ Загружено пользователей из БД: ${rows.length}`);
    });
}

// Загружаем пользователей при старте
loadUsersFromDB();


const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;
const groupChatId = process.env.GROUP_CHAT_ID;
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const bot = new TelegramBot(token, { polling: true });
const userRequests = {};
let tickets = {};
let ticketCounter = 1;
let requestsQueue = {};
let requestCounter = 1;

function isKeyboardChanged(oldKeyboard, newKeyboard) {
    if (!oldKeyboard) return true; // если старой клавиатуры нет, считаем, что изменилась
    return JSON.stringify(oldKeyboard) !== JSON.stringify(newKeyboard);
}

// ===== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ =====
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

    // создаём запись пользователя, если нет
    const isNewUser = !userRequests[id];
    if (isNewUser) {
        userRequests[id] = {
            acknowledgedRules: false,
            blocked: false,
            ticketBlocked: false,
            timestamp: 0,
            ticketTimestamp: 0,
            selectedAction: null,
            userId: id,
            username
        };
    }

    const user = userRequests[id];

    // 📸 Ссылка на изображение
    const photoUrl = 'https://image.winudf.com/v2/image/bW9iaS5hbmRyb2FwcC5wcm9zcGVyaXR5YXBwcy5jNTExMV9zY3JlZW5fN18xNTI0MDQxMDUwXzAyMQ/screen-7.jpg?fakeurl=1&type=.jpg';

    // 🧩 Если админ — сразу показываем меню, без правил
    if (botAdmins.has(Number(id))) {
        user.acknowledgedRules = true;

        // Отправка фото админу
        await bot.sendPhoto(id, photoUrl, {
            caption: `👋 Привет, ${username}! Вы вошли как администратор.`
        });

        const adminKeyboard = {
            inline_keyboard: [
                [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
            ]
        };
        return bot.sendMessage(id, `Выберите действие:`, { reply_markup: adminKeyboard });
    }

    // 🔒 Обычные пользователи — должны подтвердить правила
    const keyboard = user.acknowledgedRules
        ? {
            inline_keyboard: [
                [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
            ]
        }
        : {
            inline_keyboard: [
                [{ text: '📖 Ознакомиться с правилами', url: 'https://telegra.ph/Pravila-nashej-gruppy-10-01' }],
                [{ text: '✅ Ознакомился', callback_data: 'ack_rules' }]
            ]
        };

    // Отправка фото новым пользователям
    if (isNewUser) {
        await bot.sendPhoto(id, photoUrl, {
            caption: `👋 Привет, ${username}! Добро пожаловать!`
        });
    }

    await bot.sendMessage(id, `👋 Выберите действие:`, { reply_markup: keyboard });
});




// ===== /getchatid =====
bot.onText(/^\/getchatid$/, (msg) => {
    bot.sendMessage(msg.chat.id, `🆔 Chat ID: ${msg.chat.id}`);
});

// ===== /ticket =====
bot.onText(/^\/ticket$/, async (msg) => {
    if (msg.chat.type !== 'private') return;
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (!userRequests[userId])
        userRequests[userId] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, userId, username };

    const user = userRequests[userId];

    if (user.ticketBlocked) {
    return bot.sendMessage(userId, '🚫 Вы заблокированы и не можете отправлять тикеты.');
}


    if (!user.acknowledgedRules)
        return bot.sendMessage(userId, '⚠️ Сначала ознакомьтесь с правилами через /start.');

    // Проверяем интервал
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

    // Отправляем инструкцию и помечаем пользователя, что он сейчас отправляет тикет
    bot.sendMessage(userId, '📸 Отправьте сообщение для тикета (можете прикрепить фото, видео или документ, а также добавить подпись).');
    user.selectedAction = 'ticket_wait';
});

// ===== ОБЩАЯ ОБРАБОТКА СООБЩЕНИЙ (ТИКЕТЫ И ЗАПРОСЫ) =====
bot.on('message', async (msg) => {
    if (msg.chat.type !== 'private') return;
    const userId = msg.from.id;
    const user = userRequests[userId];
    if (!user || !['ticket_wait', 'request'].includes(user.selectedAction)) return;
    if (msg.text && msg.text.startsWith('/')) return;

    const isTicket = user.selectedAction === 'ticket_wait';
    const now = Date.now();

    // --- Тайм-аут для тикета/запроса
    const lastTimeKey = isTicket ? 'ticketTimestamp' : 'requestTimestamp';
    const minInterval = isTicket ? 60000 : 180000;
    if (user[lastTimeKey] && now - user[lastTimeKey] < minInterval) {
        const remaining = Math.ceil((minInterval - (now - user[lastTimeKey])) / 1000);
        return bot.sendMessage(userId, `⏱ Подождите ${remaining} секунд перед новым ${isTicket ? 'тикетом' : 'запросом'}.`);
    }

    // --- Проверка подписки для запроса
    if (!isTicket) {
        const subscribed = await isUserInGroup(userId);
        if (!subscribed) {
            const inviteLink = await getInviteLink();
            return bot.sendMessage(userId, '📌 Подпишитесь на группу для отправки запроса.', {
                reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
            });
        }
    }

    // --- Инициализация временного хранилища
    if (!user.tempMedia) user.tempMedia = [];
    if (!user.lastCaption) user.lastCaption = '';

    // --- Сохраняем медиа
    if (msg.photo) user.tempMedia.push({ type: 'photo', media: msg.photo.at(-1).file_id });
    else if (msg.video) user.tempMedia.push({ type: 'video', media: msg.video.file_id });
    else if (msg.document) user.tempMedia.push({ type: 'document', media: msg.document.file_id });
    else if (msg.voice) user.tempMedia.push({ type: 'voice', media: msg.voice.file_id });

    // --- Сохраняем caption (если есть)
    if (msg.caption) user.lastCaption = msg.caption;
    else if (msg.text && !msg.media_group_id) user.lastCaption = msg.text;

    // --- Таймер для медиагруппы
    clearTimeout(user.mediaTimeout);
    user.mediaTimeout = setTimeout(() => finalizeMessage(userId), msg.media_group_id ? 1500 : 500);

    // --- Финализация тикета/запроса
    async function finalizeMessage(uid) {
        const usr = userRequests[uid];
        if (!usr || usr._finalizing) return;
        usr._finalizing = true;

        const idCounter = isTicket ? ticketCounter++ : requestCounter++;
        const caption = usr.lastCaption?.trim() || '(без текста)';

        const adminCaption = isTicket
            ? `📩 *Новый тикет #${idCounter}*\n👤 ${usr.username} (${uid})\n💬 ${caption}\n\nДля ответа:\n/aticket ${idCounter} <текст ответа>`
            : `📨 *Новый запрос #${idCounter}*\n👤 [${usr.username}](tg://user?id=${uid})\n🆔 ${uid}\n💬 ${caption}`;

        const adminKeyboard = {
            inline_keyboard: isTicket
                ? [[{ text: usr.ticketBlocked ? '🔓 Разблокировать' : '🔒 Заблокировать', callback_data: `ticket_toggleBlock_${uid}_${idCounter}` }]]
                : [[
                    { text: '✅ Опубликовать', callback_data: `req_${idCounter}_publish` },
                    { text: '❌ Отклонить', callback_data: `req_${idCounter}_reject` },
                    { text: usr.requestBlocked ? '🔓 Разблокировать' : '🔒 Блок/Разблок', callback_data: `req_${idCounter}_block` }
                ]],
        };

        // Уведомление пользователя
        await bot.sendMessage(uid, `✅ Ваш ${isTicket ? 'тикет' : 'запрос'} #${idCounter} отправлен администрации.`);

        try {
            if (usr.tempMedia.length > 0) {
    if (usr.tempMedia.length === 1) {
        const m = usr.tempMedia[0];
        const sendOpts = { caption: adminCaption, parse_mode: 'Markdown' };
        let sentMsg;
        switch (m.type) {
            case 'photo': sentMsg = await bot.sendPhoto(adminChatId, m.media, sendOpts); break;
            case 'video': sentMsg = await bot.sendVideo(adminChatId, m.media, sendOpts); break;
            case 'document': sentMsg = await bot.sendDocument(adminChatId, m.media, sendOpts); break;
            case 'voice': sentMsg = await bot.sendVoice(adminChatId, m.media, sendOpts); break;
            default: sentMsg = await bot.sendMessage(adminChatId, adminCaption, { parse_mode: 'Markdown' });
        }
        // --- Прикрепляем кнопки только если caption пустой
        if (!adminCaption) {
            await bot.sendMessage(adminChatId, ' ', { reply_to_message_id: sentMsg.message_id, reply_markup: adminKeyboard });
        } else {
            // Для Telegram лучше прикреплять кнопки через отдельное сообщение с текстом " " только если caption не используется
            await bot.sendMessage(adminChatId, '⬇️ Действия', { reply_to_message_id: sentMsg.message_id, reply_markup: adminKeyboard });
        }
    } else {
        const mediaGroup = usr.tempMedia.map((m, i) => ({
            type: m.type === 'voice' ? 'audio' : m.type,
            media: m.media,
            caption: i === 0 ? adminCaption : undefined,
            parse_mode: 'Markdown'
        }));
        const sentGroup = await bot.sendMediaGroup(adminChatId, mediaGroup);
        const firstMsgId = sentGroup[0].message_id;
        // --- Кнопки к первому сообщению медиагруппы
        await bot.sendMessage(adminChatId, '⬇️ Действия', { reply_to_message_id: firstMsgId, reply_markup: adminKeyboard });
    }
} else {
    // Только текст
    await bot.sendMessage(adminChatId, adminCaption, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
}

        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
            await bot.sendMessage(adminChatId, adminCaption, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
        }

        // --- Сохраняем тикет/запрос
        if (isTicket) {
            tickets[idCounter] = { userId: uid, username: usr.username, text: caption, media: usr.tempMedia || [] };
            usr.ticketTimestamp = Date.now();
        } else {
            requestsQueue[idCounter] = { userId: uid, username: usr.username, text: caption, media: usr.tempMedia || [] };
            usr.requestTimestamp = Date.now();
        }

        usr.selectedAction = null;
        usr.tempMedia = [];
        usr.lastCaption = '';
        usr._finalizing = false;
    }
});





// ===== /aticket =====
bot.onText(/^\/aticket (\d+) (.+)/, (msg, match) => {
    if (!botAdmins.has(msg.from.id)) return; // только админы

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

    if (Object.keys(tickets).length === 0)
        return bot.sendMessage(adminChatId, '📭 Нет активных тикетов.');

    let list = '*Список активных тикетов:*\n\n';
    for (const id in tickets) {
        const t = tickets[id];
        list += `#${id} — ${t.username} (${t.userId})\n💬 ${t.text}\n\n`;
    }
    bot.sendMessage(adminChatId, list, { parse_mode: 'Markdown' });
});

// ===== CALLBACK-КНОПКИ =====
const rejectSessions = {}; // { adminId: reqId }

bot.on('callback_query', async (query) => {
    const id = query.from.id;

    // Создаём объект пользователя, если его нет
    const user = userRequests[id] ||= {
        acknowledgedRules: false,
        blocked: false,
        ticketBlocked: false,
        timestamp: 0,
        ticketTimestamp: 0,
        selectedAction: null,
        userId: id,
        username: query.from.username ? `@${query.from.username}` : query.from.first_name
    };

    // Проверка на ознакомление с правилами (только для обычных пользователей)
    if (!botAdmins.has(id)) {
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

        if (!user.acknowledgedRules) {
            return bot.answerCallbackQuery(query.id, { text: 'Ознакомьтесь с правилами.' });
        }
    }

    // ===== Проверка прав администратора для кнопок админки =====
    const adminButtons = ['req_', 'ticket_'];
    const isAdminAction = adminButtons.some(prefix => query.data.startsWith(prefix));

    if (isAdminAction && !botAdmins.has(id)) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ, пошёл вон!' });
    }

    // ===== Меню пользователя =====
    if (query.data === 'menu_request') {
        if (user.blocked) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 Вы заблокированы и не можете отправлять запросы.' });
            return;
        }
        const subscribed = await isUserInGroup(id);
        if (!subscribed) {
            const inviteLink = await getInviteLink();
            return bot.sendMessage(id, '📌 Подпишитесь на группу для отправки запроса.', {
                reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
            });
        }
        user.selectedAction = 'request';
        return bot.sendMessage(id, '📨 Отправьте сообщение (текст, фото, видео, документ) для запроса.');
    }

    if (query.data === 'menu_ticket') {
        if (user.ticketBlocked) {
            await bot.answerCallbackQuery(query.id, { text: '🚫 Вы заблокированы и не можете отправлять тикеты.' });
            return;
        }
        const subscribed = await isUserInGroup(id);
        if (!subscribed) {
            const inviteLink = await getInviteLink();
            return bot.sendMessage(id, '📌 Подпишитесь на группу для отправки тикета.', {
                reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
            });
        }
        user.selectedAction = 'ticket_wait';
        return bot.sendMessage(id, '📸 Отправьте сообщение для тикета (можете прикрепить фото, видео или документ, а также добавить подпись).');
    }

    // ===== Обработка запросов админки =====
    if (query.data.startsWith('req_')) {
        const [_, reqId, action] = query.data.split('_');
        const req = requestsQueue[reqId];
        if (!req) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Запрос уже обработан.' });
            return;
        }

        const targetUser = userRequests[req.userId] ||= { blocked: false, username: req.username };

        switch (action) {
            case 'publish': {
                try {
                    // Используем медиа из requestsQueue
                    if (req.media && req.media.length > 0) {
                        if (req.media.length === 1) {
                            const m = req.media[0];
                            const opts = { caption: req.text || undefined, parse_mode: 'Markdown' };
                            switch (m.type) {
                                case 'photo': await bot.sendPhoto(groupChatId, m.media, opts); break;
                                case 'video': await bot.sendVideo(groupChatId, m.media, opts); break;
                                case 'document': await bot.sendDocument(groupChatId, m.media, opts); break;
                                case 'voice': await bot.sendVoice(groupChatId, m.media, opts); break;
                                default: await bot.sendMessage(groupChatId, req.text || '(пустой запрос)');
                            }
                        } else {
                            const mediaGroup = req.media.map((m, i) => ({
                                type: m.type === 'voice' ? 'audio' : m.type,
                                media: m.media,
                                caption: i === 0 ? req.text || undefined : undefined,
                                parse_mode: 'Markdown'
                            }));
                            const sentGroup = await bot.sendMediaGroup(groupChatId, mediaGroup);
                        }
                    } else {
                        await bot.sendMessage(groupChatId, req.text || '(пустой запрос)');
                    }

                    await bot.sendMessage(req.userId, '✅ Ваш запрос опубликован анонимно.');
                    const adminName = userRequests[id]?.username || `ID: ${id}`;
                    await bot.sendMessage(adminChatId, `✅ Запрос #${reqId} опубликован админом [${adminName}](tg://user?id=${id}).`, { parse_mode: 'Markdown' });
                    delete requestsQueue[reqId];
                    await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
                    return;
                } catch (err) {
                    console.error('Ошибка публикации запроса:', err);
                    return bot.answerCallbackQuery(query.id, { text: 'Ошибка публикации ❌' });
                }
            }

            case 'reject': {
                rejectSessions[id] = reqId;
                await bot.sendMessage(adminChatId, `✏️ Админ [${userRequests[id]?.username || `ID:${id}` }](tg://user?id=${id}) нажал отклонить запрос #${reqId}. Напишите причину:`, { parse_mode: 'Markdown' });
                return await bot.answerCallbackQuery(query.id);
            }

            case 'block': {
    targetUser.blocked = !targetUser.blocked;
    upsertUserToDB(targetUser); // <-- сохраняем изменения в БД
    const blocked = targetUser.blocked;

    await bot.sendMessage(req.userId, blocked
        ? '🚫 Вы заблокированы и не можете отправлять запросы.'
        : '✅ Вы разблокированы и теперь можете отправлять запросы.'
    );
                const newKeyboard = {
                    inline_keyboard: [[
                        { text: '✅ Опубликовать', callback_data: `req_${reqId}_publish` },
                        { text: '❌ Отклонить', callback_data: `req_${reqId}_reject` },
                        { text: blocked ? '🔓 Разблокировать' : '🔒 Блок/Разблок', callback_data: `req_${reqId}_block` }
                    ]]
                };
                await bot.editMessageReplyMarkup(newKeyboard, { chat_id: query.message.chat.id, message_id: query.message.message_id });
                const adminName = userRequests[id]?.username || `ID: ${id}`;
                await bot.sendMessage(adminChatId, blocked
                    ? `🚫 Пользователь ${targetUser.username} заблокирован админом для запросов [${adminName}](tg://user?id=${id}).`
                    : `✅ Пользователь ${targetUser.username} разблокирован админом для запросов [${adminName}](tg://user?id=${id}).`,
                    { parse_mode: 'Markdown' }
                );
                await bot.answerCallbackQuery(query.id, { text: blocked ? '🚫 Пользователь заблокирован' : '✅ Пользователь разблокирован' });
                return;
            }
        }
    }

    // ===== Обработка тикетов =====
    if (query.data.startsWith('ticket_')) {
        const parts = query.data.split('_');
        const action = parts[1]; // toggleBlock
        const userIdTarget = parseInt(parts[2]);
        const ticketId = parseInt(parts[3]);

        const ticket = tickets[ticketId];
        if (!ticket) {
            await bot.answerCallbackQuery(query.id, { text: '❌ Тикет уже обработан.' });
            return;
        }

        userRequests[userIdTarget] ||= { blocked: false, ticketBlocked: false, username: `ID: ${userIdTarget}` };

        if (action === 'toggleBlock') {
    userRequests[userIdTarget].ticketBlocked = !userRequests[userIdTarget].ticketBlocked;
    upsertUserToDB(userRequests[userIdTarget]); // <-- сохраняем изменения в БД
    const blocked = userRequests[userIdTarget].ticketBlocked;

    await bot.sendMessage(userIdTarget, blocked
        ? '🚫 Вы заблокированы и не можете отправлять тикеты.'
        : '✅ Вы разблокированы и теперь можете отправлять тикеты.'
    );

            await bot.answerCallbackQuery(query.id, {
                text: blocked ? '🚫 Пользователь заблокирован для тикетов' : '✅ Пользователь разблокирован для тикетов'
            });

            const updatedKeyboard = {
                inline_keyboard: [
                    [{
                        text: blocked ? '🔓 Разблокировать' : '🔒 Заблокировать',
                        callback_data: `ticket_toggleBlock_${userIdTarget}_${ticketId}`
                    }]
                ]
            };

            if (isKeyboardChanged(query.message.reply_markup, updatedKeyboard)) {
                await bot.editMessageReplyMarkup(updatedKeyboard, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });
            }

            const adminName = userRequests[id]?.username || `ID: ${id}`;
            await bot.sendMessage(adminChatId, blocked
                ? `🚫 Пользователь ${userRequests[userIdTarget].username} заблокирован для тикетов админом [${adminName}](tg://user?id=${id}).`
                : `✅ Пользователь ${userRequests[userIdTarget].username} разблокирован для тикетов админом [${adminName}](tg://user?id=${id}).`,
                { parse_mode: 'Markdown' }
            );
        }
    }
});




// ===== Команда: /admin =====
bot.onText(/^\/admin(?:\s(.+))?$/, async (msg, match) => {
    const fromId = msg.from.id;

    // Разрешаем только администраторам
    if (!botAdmins.has(Number(fromId))) {
        return bot.sendMessage(msg.chat.id, '❌ У вас нет прав для назначения администраторов.');
    }

    const target = match[1]?.trim();
    if (!target) {
        return bot.sendMessage(msg.chat.id, '⚠️ Использование: /admin <id|@username>');
    }

    try {
        let userId = null;
        let displayName = null;

        // === Если передан username ===
        if (target.startsWith('@')) {
            const usernameQuery = target.slice(1);
            const response = await fetch(
                `http://c14.play2go.cloud:20028/api/user?username=${encodeURIComponent(usernameQuery)}`
            );

            if (!response.ok) {
                return bot.sendMessage(msg.chat.id, `❌ Ошибка API: ${response.status}`);
            }

            const data = await response.json();
            const userData = data?.user || (Array.isArray(data) && data[0]) || data;

            if (!userData?.id) {
                return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден через API.');
            }

            userId = Number(userData.id);
            displayName = userData.username ? `@${userData.username}` : userData.first_name || target;
        } else {
            // === Если передан числовой ID ===
            userId = Number(target);
            if (isNaN(userId)) {
                return bot.sendMessage(msg.chat.id, '❌ Неверный ID пользователя.');
            }
            displayName = target;
        }

        // === Добавляем в список админов ===
        botAdmins.add(Number(userId));
        addAdminToDB(Number(userId), displayName);
        userRequests[userId] ||= {};
        userRequests[userId].username = displayName;

        bot.sendMessage(msg.chat.id, `✅ Пользователь ${displayName} назначен администратором.`);
    } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Не удалось получить данные пользователя через API.');
    }
});

// ===== Команда: /unadmin =====
bot.onText(/^\/unadmin(?:\s(.+))?$/, async (msg, match) => {
    const fromId = msg.from.id;

    // Проверяем права — только админы могут снимать других админов
    if (!botAdmins.has(Number(fromId))) {
        return bot.sendMessage(msg.chat.id, '❌ У вас нет прав для снятия администраторов.');
    }

    const target = match[1]?.trim();
    if (!target) {
        return bot.sendMessage(msg.chat.id, '⚠️ Использование: /unadmin <id|@username>');
    }

    try {
        let userId = null;

        // === Если передан username ===
        if (target.startsWith('@')) {
            const usernameQuery = target.slice(1);
            const response = await fetch(
                `http://c14.play2go.cloud:20028/api/user?username=${encodeURIComponent(usernameQuery)}`
            );

            if (!response.ok) {
                return bot.sendMessage(msg.chat.id, `❌ Ошибка API: ${response.status}`);
            }

            const data = await response.json();
            const userData = data?.user || (Array.isArray(data) && data[0]) || data;

            if (!userData?.id) {
                return bot.sendMessage(msg.chat.id, '❌ Пользователь не найден через API.');
            }

            userId = Number(userData.id);
        } else {
            // === Если передан числовой ID ===
            userId = Number(target);
            if (isNaN(userId)) {
                return bot.sendMessage(msg.chat.id, '❌ Неверный ID пользователя.');
            }
        }

        // === Защита: нельзя снять главного админа ===
        if (userId === 774756964) {
            return bot.sendMessage(msg.chat.id, '⚠️ Нельзя снять главного администратора.');
        }

        // === Проверяем, есть ли пользователь среди админов ===
        if (!botAdmins.has(Number(userId))) {
            return bot.sendMessage(msg.chat.id, '❌ Этот пользователь не является администратором.');
        }

        // === Удаляем из списка ===
        botAdmins.delete(Number(userId));
        removeAdminFromDB(Number(userId));

        const username = userRequests[userId]?.username || `ID: ${userId}`;
        bot.sendMessage(msg.chat.id, `✅ Пользователь ${username} снят с прав администратора.`);
    } catch (err) {
        bot.sendMessage(msg.chat.id, '❌ Не удалось обработать запрос. Проверьте правильность данных.');
    }
});


// ===== Команда: /admins =====
bot.onText(/^\/admins$/, (msg) => {
    const chatId = msg.chat.id;
    const fromId = msg.from.id;

    // Проверяем права
    if (!botAdmins.has(Number(fromId))) {
        return bot.sendMessage(chatId, '❌ У вас нет прав для просмотра списка администраторов.');
    }

    // Главный админ (кодер)
    const coderName = `[@zoomflyru](tg://user?id=774756964)`;

    // Остальные админы
    const otherAdmins = [...botAdmins]
        .filter(id => id !== 774756964)
        .map(id => {
            const user = userRequests[id] || {};
            if (user.username) return `[${user.username}](tg://user?id=${id})`;
            if (user.first_name) return user.first_name;
            return `\`${id}\``;
        });

    let response = `👑 *Кодер:*\n${coderName}\n\n🛡 *Админы:*\n`;
    response += otherAdmins.length ? otherAdmins.join('\n') : '— Нет админов —';

    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
});


// ===== ОБРАБОТКА ЗАПРОСОВ =====
bot.on('message', async (msg) => {
    const userId = msg.from.id;

    // ===== Проверяем, пишет ли админ причину отклонения =====
    if (botAdmins.has(userId) && rejectSessions[userId]) {
        const reqId = rejectSessions[userId];
        const req = requestsQueue[reqId];
        if (!req) {
            delete rejectSessions[userId];
            return bot.sendMessage(userId, '❌ Этот запрос уже обработан.');
        }

        const reason = msg.text || '(без причины)';
        const targetUserId = req.userId;

        await bot.sendMessage(targetUserId, `❌ Ваш запрос отклонён администрацией по причине: ${reason}`);
        const adminName = userRequests[userId]?.username || `ID: ${userId}`;
        await bot.sendMessage(adminChatId, `❌ Запрос #${reqId} отклонён админом [${adminName}](tg://user?id=${userId}) по причине: ${reason}`, { parse_mode: 'Markdown' });

        delete requestsQueue[reqId];
        delete rejectSessions[userId];
        return;
    }

    // Игнорируем групповые чаты
    if (msg.chat.type !== 'private') return;

    // Создаём или получаем объект пользователя
    const user = userRequests[userId] ||= {
        acknowledgedRules: false,
        blocked: false,
        requestBlocked: false,
        selectedAction: null,
        userId,
        username: msg.from.username ? `@${msg.from.username}` : msg.from.first_name
    };

    // Игнорируем команды
    if (msg.text && msg.text.startsWith('/')) return;

    // ===== ОБРАБОТКА ПУСТЫХ/ОБЫЧНЫХ СООБЩЕНИЙ =====
    if (!user.selectedAction) {
        if (!user.blocked && !user.requestBlocked) {
            const keyboard = user.acknowledgedRules
                ? {
                    inline_keyboard: [
                        [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                        [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
                    ]
                }
                : {
                    inline_keyboard: [
                        [{ text: '📖 Ознакомиться с правилами', url: 'https://telegra.ph/Pravila-nashej-gruppy-10-01' }],
                        [{ text: '✅ Ознакомился', callback_data: 'ack_rules' }]
                    ]
                };

            return bot.sendMessage(userId, '👋 Выберите действие:', { reply_markup: keyboard });
        }
    }
    
});
