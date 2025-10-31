// handlers/message_processor.js (Обработка сообщений в режиме ожидания)

const { isUserInGroup, getInviteLink } = require('../utils');
const { ticketCounter, requestCounter } = require('../sessions');

let currentTicketCounter = 1;
let currentRequestCounter = 1;

module.exports = (bot, userRequests, tickets, requestsQueue, adminChatId, groupChatId) => {
    // Обновляем счётчики
    currentTicketCounter = require('../sessions').ticketCounter;
    currentRequestCounter = require('../sessions').requestCounter;

    // ОБЩАЯ ОБРАБОТКА СООБЩЕНИЙ (ТИКЕТЫ И ЗАПРОСЫ)
    bot.on('message', async (msg) => {
        if (msg.chat.type !== 'private') return;
        const userId = msg.from.id;
        const user = userRequests[userId];
        if (!user || !['ticket_wait', 'request'].includes(user.selectedAction)) return;
        if (msg.text && msg.text.startsWith('/')) return;

        const isTicket = user.selectedAction === 'ticket_wait';
        const now = Date.now();

        // Проверка на блокировку (на всякий случай, хотя должна быть на этапе меню)
        if (isTicket && user.ticketBlocked) return;
        if (!isTicket && user.blocked) return;

        // Проверка на флуд
        const lastTimeKey = isTicket ? 'ticketTimestamp' : 'timestamp'; // В вашем коде для запроса использовался 'timestamp', а не 'requestTimestamp'
        const minInterval = isTicket ? 60000 : 180000;
        if (user[lastTimeKey] && now - user[lastTimeKey] < minInterval) {
            const remaining = Math.ceil((minInterval - (now - user[lastTimeKey])) / 1000);
            try {
                await bot.sendMessage(userId, `⏱ Подождите ${remaining} секунд перед новым ${isTicket ? 'тикетом' : 'запросом'}.`);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        // Проверка на подписку для запроса
        if (!isTicket) {
            const subscribed = await isUserInGroup(bot, groupChatId, userId);
            if (!subscribed) {
                const inviteLink = await getInviteLink(bot, groupChatId);
                try {
                    await bot.sendMessage(userId, '📌 Подпишитесь на группу для отправки запроса.', {
                        reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
                    });
                } catch (err) {
                    console.error('Ошибка отправки сообщения:', err);
                }
                return;
            }
        }

        // Обработка медиа-групп и подписей
        if (!user.tempMedia) user.tempMedia = [];
        if (!user.lastCaption) user.lastCaption = '';

        if (msg.photo) user.tempMedia.push({ type: 'photo', media: msg.photo.at(-1).file_id });
        else if (msg.video) user.tempMedia.push({ type: 'video', media: msg.video.file_id });
        else if (msg.document) user.tempMedia.push({ type: 'document', media: msg.document.file_id });
        else if (msg.voice) user.tempMedia.push({ type: 'voice', media: msg.voice.file_id });

        if (msg.caption) user.lastCaption = msg.caption;
        else if (msg.text && !msg.media_group_id) user.lastCaption = msg.text;

        // Ожидание завершения медиа-группы
        clearTimeout(user.mediaTimeout);
        user.mediaTimeout = setTimeout(() => finalizeMessage(userId), msg.media_group_id ? 1500 : 500);
    });

    // Функция завершения отправки сообщения
    async function finalizeMessage(uid) {
        const usr = userRequests[uid];
        if (!usr || usr._finalizing) return;
        usr._finalizing = true;

        const isTicket = usr.selectedAction === 'ticket_wait';
        const sessions = require('../sessions'); // Доступ к глобальным счётчикам

        const idCounter = isTicket ? sessions.ticketCounter++ : sessions.requestCounter++;
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
                    { text: usr.blocked ? '🔓 Разблокировать' : '🔒 Блок/Разблок', callback_data: `req_${idCounter}_block` }
                ]],
        };

        try {
            await bot.sendMessage(uid, `✅ Ваш ${isTicket ? 'тикет' : 'запрос'} #${idCounter} отправлен администрации.`);
        } catch (err) {
            console.error('Ошибка отправки подтверждения пользователю:', err);
        }

        try {
            if (usr.tempMedia.length > 0) {
                const mediaGroup = usr.tempMedia.map((m, i) => ({
                    type: m.type === 'voice' ? 'audio' : m.type,
                    media: m.media,
                    caption: i === 0 ? adminCaption : undefined,
                    parse_mode: 'Markdown'
                }));

                if (usr.tempMedia.length === 1 && mediaGroup[0].type !== 'audio') {
                    // Отправка одного файла
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
                    try {
                        await bot.sendMessage(adminChatId, '⬇️ Действия', { reply_to_message_id: sentMsg.message_id, reply_markup: adminKeyboard });
                    } catch (err) {
                        console.error('Ошибка отправки кнопок:', err);
                    }
                } else {
                    // Отправка медиа-группы или войса
                    const sentGroup = await bot.sendMediaGroup(adminChatId, mediaGroup);
                    const firstMsgId = sentGroup[0].message_id;
                    try {
                        await bot.sendMessage(adminChatId, '⬇️ Действия', { reply_to_message_id: firstMsgId, reply_markup: adminKeyboard });
                    } catch (err) {
                        console.error('Ошибка отправки кнопок:', err);
                    }
                }
            } else {
                // Отправка только текста
                await bot.sendMessage(adminChatId, adminCaption, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
            }
        } catch (err) {
            console.error('Ошибка отправки сообщения админу:', err);
            try {
                // Fallback для текста, если медиа не отправилось
                await bot.sendMessage(adminChatId, adminCaption, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
            } catch (fallbackErr) {
                console.error('Ошибка fallback отправки:', fallbackErr);
            }
        }

        const now = Date.now(); // Определяем метку времени один раз

        if (isTicket) {
            // ✅ ИСПРАВЛЕНИЕ: Добавляем timestamp в объект тикета
            tickets[idCounter] = { userId: uid, username: usr.username, text: caption, media: usr.tempMedia || [], timestamp: now };
            usr.ticketTimestamp = now;
        } else {
            // ✅ ИСПРАВЛЕНИЕ: Добавляем timestamp в объект запроса
            requestsQueue[idCounter] = { userId: uid, username: usr.username, text: caption, media: usr.tempMedia || [], timestamp: now };
            usr.timestamp = now;
        }

        usr.selectedAction = null;
        usr.tempMedia = [];
        usr.lastCaption = '';
        usr._finalizing = false;
    }
};