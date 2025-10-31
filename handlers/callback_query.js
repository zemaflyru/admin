// handlers/callback_query.js

const { upsertUserToDB } = require('../db');
// ✅ Убедитесь, что escapeMarkdown импортирован из utils.js
const { isUserInGroup, getInviteLink, isKeyboardChanged, escapeMarkdown } = require('../utils'); 
const { MESSAGES, generateAdminKeyboard, RULES_URL, MAIN_MENU_KEYBOARD } = require('../messages/texts'); 

// 🔑 Вспомогательная функция для генерации кнопок действий для Запроса (req_)
function generateAdminKeyboardForRequest(reqId, isBlocked) {
    return {
        inline_keyboard: [
            [
                {
                    text: isBlocked ? '🔓 Разблокировать запросы' : '🔒 Заблокировать запросы',
                    callback_data: `req_${reqId}_block`
                },
                {
                    text: '❌ Отклонить',
                    callback_data: `req_${reqId}_reject`
                },
                {
                    text: '✅ Опубликовать',
                    callback_data: `req_${reqId}_publish`
                }
            ]
        ]
    };
}

// 🔑 Вспомогательная функция для генерации кнопок действий для Тикета (ticket_)
function generateAdminKeyboardForTicket(ticketId, targetUserId, isBlocked) {
    return {
        inline_keyboard: [
            [{
                text: isBlocked ? '🔓 Разблокировать тикеты' : '🔒 Заблокировать тикеты',
                callback_data: `ticket_toggleBlock_${targetUserId}_${ticketId}` 
            }]
        ]
    };
}

module.exports = (bot, botAdmins, userRequests, requestsQueue, tickets, rejectSessions, adminMessageSessions, adminChatId, groupChatId) => {
    bot.on('callback_query', async (query) => {
        const id = query.from.id;
        const data = query.data;

        const user = userRequests[id] ||= {
            blocked: false,
            ticketBlocked: false,
            userId: id,
            username: query.from.username ? `@${query.from.username}` : query.from.first_name
        };
        
        // --- 1. Просмотр тикета/запроса из списка /tickets или /requests (ОБНОВЛЕНО) ---
        if (data.startsWith('showTicket_') || data.startsWith('showRequest_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ!' });
            
            const isTicket = data.startsWith('showTicket_');
            const itemId = data.split('_')[1];
            const queue = isTicket ? tickets : requestsQueue;
            const item = queue[itemId];
            const chatId = query.message.chat.id;

            await bot.answerCallbackQuery(query.id, { text: isTicket ? `Просмотр тикета #${itemId}` : `Просмотр запроса #${itemId}` });

            if (!item) {
                return bot.sendMessage(chatId, isTicket ? '❌ Тикет не найден или уже обработан.' : '❌ Запрос не найден или уже обработан.');
            }

            const { userId, username, text, media } = item;
            const targetUser = userRequests[userId] ||= { blocked: false, ticketBlocked: false, userId: userId, username: username };
            const type = isTicket ? 'ТИКЕТ' : 'ЗАПРОС';
            
            // Формируем заголовок сообщения
            let adminCaption = 
                `*${isTicket ? '🎫' : '📨'} СОДЕРЖАНИЕ ${type}А #${itemId}*` +
                ` от ${escapeMarkdown(username || `ID:${userId}`)} ([${userId}](tg://user?id=${userId}))\n\n` +
                `*Содержание:*\n${escapeMarkdown(text || '(без текста)')}`; // ✅ Экранируем пользовательский текст

            // ✅ ДОБАВЛЕНИЕ КОМАНДЫ ДЛЯ ОТВЕТА НА ТИКЕТ
            if (isTicket) {
                adminCaption += `\n\n------------------------\n`
                             + `*✍️ Команда для ответа:* \`/aticket ${itemId}\``; // Используем код-блок для команды
            }
            
            const adminKeyboard = isTicket 
                ? generateAdminKeyboardForTicket(itemId, userId, targetUser.ticketBlocked) 
                : generateAdminKeyboardForRequest(itemId, targetUser.blocked);

            try {
                // Если есть медиа, отправляем его
                if (media && media.length > 0) {
                    if (media.length > 1) {
                        const mediaGroup = media.map((m, index) => ({
                            type: m.type,
                            media: m.media,
                            caption: index === 0 ? adminCaption : undefined, 
                            parse_mode: index === 0 ? 'Markdown' : undefined
                        }));
                        await bot.sendMediaGroup(chatId, mediaGroup);
                        if (adminKeyboard) {
                            await bot.sendMessage(chatId, '⬇️ Действия', { reply_markup: adminKeyboard });
                        }
                    } else if (media.length === 1 && media[0].type) {
                        const singleMedia = media[0];
                        let method = '';
                        if (singleMedia.type === 'photo') method = 'sendPhoto';
                        else if (singleMedia.type === 'video') method = 'sendVideo';
                        else if (singleMedia.type === 'document') method = 'sendDocument';
                        else if (singleMedia.type === 'voice') method = 'sendVoice';
                        
                        if (method) {
                            await bot[method](chatId, singleMedia.media, { 
                                caption: adminCaption, 
                                parse_mode: 'Markdown', 
                                reply_markup: adminKeyboard
                            });
                        } else {
                             await bot.sendMessage(chatId, adminCaption + '\n\n⚠️ *Прикреплено медиа неизвестного типа.*', { parse_mode: 'Markdown', reply_markup: adminKeyboard });
                        }
                    } 
                } else {
                    // Отправка только текста
                    await bot.sendMessage(chatId, adminCaption, { parse_mode: 'Markdown', reply_markup: adminKeyboard });
                }

            } catch (err) {
                console.error(`Ошибка отправки содержимого ${type}а #${itemId}:`, err);
                await bot.sendMessage(chatId, '❌ Произошла ошибка при отображении содержимого. Проверьте логи.');
            }
            return;
        }

        // --- 2. Обработка кнопок из команды /get (Toggle Blocks и Write User) ---

        if (data.startsWith('toggleBlockReq_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ!' });

            const uid = parseInt(data.split('_')[1]);
            const usr = userRequests[uid] ||= { blocked: false, ticketBlocked: false, userId: uid, username: `ID:${uid}` };
            usr.blocked = !usr.blocked;
            upsertUserToDB(usr);

            const adminName = userRequests[id]?.username || `ID:${id}`;
            try {
                await bot.sendMessage(adminChatId, usr.blocked
                    ? `🚫 Пользователь ${usr.username} заблокирован админом для запросов [${adminName}](tg://user?id=${id}).`
                    : `✅ Пользователь ${usr.username} разблокирован админом для запросов [${adminName}](tg://user?id=${id}).`,
                    { parse_mode: 'Markdown' }
                );

                // ОБНОВЛЕНО: Используем generateAdminKeyboard
                await bot.editMessageReplyMarkup(generateAdminKeyboard(usr.blocked, usr.ticketBlocked), {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });

                await bot.answerCallbackQuery(query.id, { text: usr.blocked ? '🚫 Пользователь заблокирован для запросов' : '✅ Пользователь разблокирован для запросов' });
            } catch (err) {
                console.error('Ошибка обработки блокировки запросов:', err);
            }
            return;
        }

        if (data.startsWith('toggleBlockTicket_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ!' });

            const uid = parseInt(data.split('_')[1]);
            const usr = userRequests[uid] ||= { blocked: false, ticketBlocked: false, userId: uid, username: `ID:${uid}` };
            usr.ticketBlocked = !usr.ticketBlocked;
            upsertUserToDB(usr);

            const adminName = userRequests[id]?.username || `ID:${id}`;
            try {
                await bot.sendMessage(adminChatId, usr.ticketBlocked
                    ? `🚫 Пользователь ${usr.username} заблокирован админом для тикетов [${adminName}](tg://user?id=${id}).`
                    : `✅ Пользователь ${usr.username} разблокирован админом для тикетов [${adminName}](tg://user?id=${id}).`,
                    { parse_mode: 'Markdown' }
                );

                // ОБНОВЛЕНО: Используем generateAdminKeyboard
                await bot.editMessageReplyMarkup(generateAdminKeyboard(usr.blocked, usr.ticketBlocked), {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });

                await bot.answerCallbackQuery(query.id, { text: usr.ticketBlocked ? '🚫 Пользователь заблокирован для тикетов' : '✅ Пользователь разблокирован для тикетов' });
            } catch (err) {
                console.error('Ошибка обработки блокировки тикетов:', err);
            }
            return;
        }

        if (data.startsWith('writeUser_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ!' });

            const uid = parseInt(data.split('_')[1]);
            const usr = userRequests[uid];

            if (!usr) {
                return bot.answerCallbackQuery(query.id, { text: '❌ Пользователь не найден.' });
            }

            adminMessageSessions[id] = uid;

            try {
                await bot.sendMessage(adminChatId, MESSAGES.WRITE_USER_PROMPT(usr.username));
                await bot.answerCallbackQuery(query.id, { text: '📝 Напишите сообщение в админ чат' });
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        // --- 3. Обработка кнопок из /start (Ознакомление с правилами) ---

        if (data === 'ack_rules') {
            user.acknowledgedRules = true;
            upsertUserToDB(user);
            try {
                await bot.sendMessage(id, '✅ Отлично! Теперь вы можете отправлять запросы и тикеты.', {
                    reply_markup: MAIN_MENU_KEYBOARD 
                });
                await bot.answerCallbackQuery(query.id);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        // --- 4. Кнопки для перехода в режим отправки запроса/тикета ---

        if (data === 'menu_request') {
            if (user.blocked) {
                return bot.answerCallbackQuery(query.id, { text: '🚫 Вы заблокированы и не можете отправлять запросы.' });
            }
            if (!user.acknowledgedRules) {
                return bot.answerCallbackQuery(query.id, { text: 'Ознакомьтесь с правилами через /start.' });
            }
            const subscribed = await isUserInGroup(bot, groupChatId, id);
            if (!subscribed) {
                const inviteLink = await getInviteLink(bot, groupChatId);
                return bot.sendMessage(id, '📌 Подпишитесь на группу для отправки запроса.', {
                    reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
                });
            }
            user.selectedAction = 'request';
            try {
                await bot.sendMessage(id, '📨 Отправьте сообщение (текст, фото, видео, документ) для запроса.');
                await bot.answerCallbackQuery(query.id);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        if (data === 'menu_ticket') {
            if (user.ticketBlocked) {
                return bot.answerCallbackQuery(query.id, { text: '🚫 Вы заблокированы и не можете отправлять тикеты.' });
            }
            if (!user.acknowledgedRules) {
                return bot.answerCallbackQuery(query.id, { text: 'Ознакомьтесь с правилами через /start.' });
            }
            const subscribed = await isUserInGroup(bot, groupChatId, id);
            if (!subscribed) {
                const inviteLink = await getInviteLink(bot, groupChatId);
                return bot.sendMessage(id, '📌 Подпишитесь на группу для отправки тикета.', {
                    reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
                });
            }
            user.selectedAction = 'ticket_wait';
            try {
                await bot.sendMessage(id, '📸 Отправьте сообщение для тикета (можете прикрепить фото, видео или документ, а также добавить подпись).');
                await bot.answerCallbackQuery(query.id);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        // --- 5. Действия администраторов с запросами (req_) и их блокировка ---

        if (data.startsWith('req_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ, пошёл вон!' });

            const [_, reqId, action] = data.split('_');
            const req = requestsQueue[reqId];
            if (!req) return bot.answerCallbackQuery(query.id, { text: '❌ Запрос уже обработан.' });

            const targetUser = userRequests[req.userId] ||= { blocked: false, ticketBlocked: false, userId: req.userId, username: req.username };

            switch (action) {
                case 'publish': {
                    try {
                        // Логика публикации в группу
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
                                await bot.sendMediaGroup(groupChatId, mediaGroup);
                            }
                        } else {
                            await bot.sendMessage(groupChatId, req.text || '(пустой запрос)');
                        }

                        await bot.sendMessage(req.userId, '✅ Ваш запрос опубликован анонимно.');
                        const adminName = userRequests[id]?.username || `ID: ${id}`;
                        await bot.sendMessage(adminChatId, `✅ Запрос #${reqId} опубликован админом [${adminName}](tg://user?id=${id}).`, { parse_mode: 'Markdown' });
                        delete requestsQueue[reqId];
                        
                        // Обновление: Очищаем кнопки после обработки
                        await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: query.message.chat.id, message_id: query.message.message_id });
                        await bot.answerCallbackQuery(query.id, { text: '✅ Опубликовано' });
                        return;
                    } catch (err) {
                        console.error('Ошибка публикации запроса:', err);
                        return bot.answerCallbackQuery(query.id, { text: 'Ошибка публикации ❌' });
                    }
                }

                case 'reject': {
                    rejectSessions[id] = reqId;
                    try {
                        const adminId = id; 
                        const adminName = userRequests[adminId]?.username || `ID:${adminId}`;
                        
                        const rejectMessage = MESSAGES.REJECT_PROMPT(adminName, reqId, adminId);
                        
                        await bot.sendMessage(adminChatId, rejectMessage, { parse_mode: 'Markdown' });
                        await bot.answerCallbackQuery(query.id, { text: '✏️ Ожидание причины отклонения...' });
                    } catch (err) {
                        console.error('Ошибка отправки сообщения:', err);
                        return bot.answerCallbackQuery(query.id, { text: 'Ошибка: проверьте логи.' });
                    }
                    return;
                }

                case 'block': {
                    targetUser.blocked = !targetUser.blocked;
                    upsertUserToDB(targetUser);
                    const blocked = targetUser.blocked;
                    
                    const adminName = userRequests[id]?.username || `ID: ${id}`;
                    await bot.sendMessage(adminChatId, blocked
                        ? `🚫 Пользователь ${targetUser.username} заблокирован для запросов админом [${adminName}](tg://user?id=${id}).`
                        : `✅ Пользователь ${targetUser.username} разблокирован для запросов админом [${adminName}](tg://user?id=${id}).`,
                        { parse_mode: 'Markdown' }
                    );
                    
                    // Обновление: Используем generateAdminKeyboardForRequest
                    const newKeyboard = generateAdminKeyboardForRequest(reqId, blocked);

                    await bot.editMessageReplyMarkup(newKeyboard, {
                        chat_id: query.message.chat.id,
                        message_id: query.message.message_id
                    });

                    await bot.answerCallbackQuery(query.id, { text: blocked ? '🚫 Пользователь заблокирован для запросов' : '✅ Пользователь разблокирован для запросов' });
                    return;
                }

                default: {
                    return bot.answerCallbackQuery(query.id, { text: 'Неизвестное действие' });
                }
            }
        }
        
        // --- 6. Действия администраторов с тикетами (ticket_toggleBlock_) ---

        if (data.startsWith('ticket_toggleBlock_')) {
            if (!botAdmins.has(id)) return bot.answerCallbackQuery(query.id, { text: '❌ Ты не админ!' });

            const parts = data.split('_');
            const userIdTarget = parseInt(parts[2]);
            const ticketId = parts[3]; 

            const targetUser = userRequests[userIdTarget] ||= { blocked: false, ticketBlocked: false, userId: userIdTarget, username: `ID:${userIdTarget}` };
            targetUser.ticketBlocked = !targetUser.ticketBlocked;
            upsertUserToDB(targetUser);
            const blocked = targetUser.ticketBlocked;

            try {
                await bot.sendMessage(userIdTarget, blocked
                    ? '🚫 Вы заблокированы и не можете отправлять тикеты.'
                    : '✅ Вы разблокированы и теперь можете отправлять тикеты.'
                );

                // Обновление: Используем новую функцию для обновления клавиатуры
                const updatedKeyboard = generateAdminKeyboardForTicket(ticketId, userIdTarget, blocked);

                await bot.editMessageReplyMarkup(updatedKeyboard, {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id
                });

                const adminName = userRequests[id]?.username || `ID: ${id}`;
                await bot.sendMessage(adminChatId, blocked
                    ? `🚫 Пользователь ${targetUser.username} заблокирован для тикетов админом [${adminName}](tg://user?id=${id}).`
                    : `✅ Пользователь ${targetUser.username} разблокирован для тикетов админом [${adminName}](tg://user?id=${id}).`,
                    { parse_mode: 'Markdown' }
                );

                await bot.answerCallbackQuery(query.id, { text: blocked ? '🚫 Пользователь заблокирован для тикетов' : '✅ Пользователь разблокирован для тикетов' });
            } catch (err) {
                console.error('Ошибка обработки блокировки тикетов:', err);
            }
        }
    });
};