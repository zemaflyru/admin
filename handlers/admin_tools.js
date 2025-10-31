// handlers/admin_tools.js

const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { addAdminToDB, removeAdminFromDB, getAllUserIds } = require('../db');
const { escapeMarkdown, isUserInGroup, getUserDBStats } = require('../utils');
const { rejectSessions, adminMessageSessions, broadcastSession } = require('../sessions');

// Импорт всех текстов и констант
const { 
    MESSAGES, 
    generateAdminKeyboard, 
    CODER_ID, 
    CODER_USERNAME 
} = require('../messages/texts'); 

const MAIN_ADMIN_ID = CODER_ID; 

// ОБНОВЛЕНО: Добавлены tickets и requestsQueue в параметры модуля
module.exports = (bot, botAdmins, userRequests, tickets, requestsQueue, adminChatId, groupChatId) => {
    // Вспомогательная функция для проверки прав и чата
    const checkAdminAndChat = async (msg) => {
        // 🛑 FIX: Проверка на существование msg, msg.chat, msg.chat.id и msg.from.id
        if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) {
            return false;
        }

        const fromId = msg.from.id;
        const chatId = msg.chat.id;
        
        if (!botAdmins.has(Number(fromId))) {
            try {
                await bot.sendMessage(chatId, MESSAGES.NO_PERMISSIONS); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return false;
        }

        if (chatId.toString() !== adminChatId.toString()) {
            return false;
        }
        return true;
    };
    
    // /getchatid
    bot.onText(/^\/getchatid$/, async (msg) => {
        if (!msg || !msg.chat || !msg.chat.id) return; // 🛑 FIX: Добавлена проверка

        try {
            await bot.sendMessage(msg.chat.id, `🆔 Chat ID: ${msg.chat.id}`);
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
    });

    // /stats
    bot.onText(/^\/stats$/, async (msg) => {
        if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) return; // 🛑 FIX: Добавлена проверка

        const chatId = msg.chat.id;
        const fromId = msg.from.id;

        if (!botAdmins.has(Number(fromId))) return;
        if (chatId.toString() !== adminChatId.toString()) return;

        let statusMsg;
        try {
            statusMsg = await bot.sendMessage(chatId, '📊 Загружаем статистику...');
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
            return;
        }

        getUserDBStats(async (err, stats) => {
            if (err) {
                try {
                    await bot.editMessageText('❌ Ошибка при подсчёте статистики', { chat_id: chatId, message_id: statusMsg.message_id });
                } catch (editErr) {
                    console.error('Ошибка редактирования сообщения:', editErr);
                }
                return;
            }

            const { totalUsers, blockedUsers } = stats;
            // Используем переданные объекты tickets и requestsQueue
            const totalTickets = Object.keys(tickets).length;
            const totalRequests = Object.keys(requestsQueue).length;

            const text = `📊 *Статистика бота:*\n\n` +
                         `👥 Всего пользователей: ${totalUsers}\n` +
                         `🚫 Заблокировано пользователей (запросы/тикеты): ${blockedUsers}\n` +
                         `🎫 Активные тикеты: ${totalTickets}\n` +
                         `📨 Активные запросы: ${totalRequests}`;

            try {
                await bot.editMessageText(text, { chat_id: chatId, message_id: statusMsg.message_id, parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Ошибка редактирования сообщения:', err);
            }
        });
    });

    // /get
    bot.onText(/^\/get(?:\s(.+))?$/, async (msg, match) => {
        if (!msg || !msg.from || !msg.from.id || !msg.chat || !msg.chat.id) return; // 🛑 FIX: Добавлена проверка

        const fromId = msg.from.id;

        if (!botAdmins.has(Number(fromId))) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.NO_PERMISSIONS); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const target = match[1]?.trim();
        if (!target) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/get <id|@username>')); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        try {
            let userId = null;
            let displayName = null;

            const targetAsNumber = Number(target);

            if (!isNaN(targetAsNumber)) {
                // Улучшение: если введён численный ID, используем его напрямую
                userId = targetAsNumber;
                displayName = userRequests[userId]?.username || `ID: ${userId}`;
            } else if (target.startsWith('@')) {
                const usernameQuery = target.slice(1);
                // Запрос к внешнему API
                const response = await fetch(
                    `http://c14.play2go.cloud:20028/api/user?username=${encodeURIComponent(usernameQuery)}`
                );

                if (!response.ok) {
                    await bot.sendMessage(msg.chat.id, `❌ Ошибка API: ${response.status}`);
                    return;
                }

                const data = await response.json();
                const userData = data?.user || (Array.isArray(data) && data[0]) || data;

                if (!userData?.id) {
                    await bot.sendMessage(msg.chat.id, MESSAGES.USER_NOT_FOUND); 
                    return;
                }

                userId = Number(userData.id);
                displayName = userData.username ? `@${userData.username}` : userData.first_name || target;
            } else {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/get <id|@username>')); 
                return;
            }

            const user = userRequests[userId] ||= {
                blocked: false,
                ticketBlocked: false,
                userId,
                username: displayName
            };

            const memberStatus = await isUserInGroup(bot, groupChatId, userId) ? 'Участник группы' : 'Не в группе';
            const isAdmin = botAdmins.has(userId) ? 'Админ' : 'Пользователь';

            const safeUsername = escapeMarkdown(user.username);

            const text = `👤 *Пользователь:* ${safeUsername}\n` +
                         `🆔 *ID:* ${userId}\n` +
                         `💬 *Статус:* ${isAdmin}\n` +
                         `🚫 *Заблокирован для запросов:* ${user.blocked ? 'Да' : 'Нет'}\n` +
                         `🎫 *Заблокирован для тикетов:* ${user.ticketBlocked ? 'Да' : 'Нет'}\n` +
                         `🔗 *В группе:* ${memberStatus}`;

            // ОБНОВЛЕНО: Передача userId
            const keyboard = generateAdminKeyboard(user.blocked, user.ticketBlocked, userId); 

            await bot.sendMessage(msg.chat.id, text, {
                parse_mode: 'Markdown',
                reply_markup: keyboard
            });
        } catch (err) {
            console.error(err);
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.USER_NOT_FOUND); 
            } catch (sendErr) {
                console.error('Ошибка отправки сообщения об ошибке:', sendErr);
            }
        }
    });

    // /admin
    bot.onText(/^\/admin(?:\s(.+))?$/, async (msg, match) => {
        if (!msg || !msg.from || !msg.from.id || !msg.chat || !msg.chat.id) return; // 🛑 FIX: Добавлена проверка

        const fromId = msg.from.id;

        if (!botAdmins.has(Number(fromId))) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.NO_PERMISSIONS); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const target = match[1]?.trim();
        if (!target) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/admin <id|@username>')); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        try {
            let userId = null;
            let displayName = null;

            const targetAsNumber = Number(target);

            if (!isNaN(targetAsNumber)) {
                userId = targetAsNumber;
                displayName = userRequests[userId]?.username || `ID: ${userId}`;
            } else if (target.startsWith('@')) {
                const usernameQuery = target.slice(1);
                const response = await fetch(
                    `http://c14.play2go.cloud:20028/api/user?username=${encodeURIComponent(usernameQuery)}`
                );

                if (!response.ok) {
                    await bot.sendMessage(msg.chat.id, `❌ Ошибка API: ${response.status}`);
                    return;
                }

                const data = await response.json();
                const userData = data?.user || (Array.isArray(data) && data[0]) || data;

                if (!userData?.id) {
                    await bot.sendMessage(msg.chat.id, MESSAGES.USER_NOT_FOUND); 
                    return;
                }

                userId = Number(userData.id);
                displayName = userData.username ? `@${userData.username}` : userData.first_name || target;
            } else {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/admin <id|@username>')); 
                return;
            }

            botAdmins.add(Number(userId));
            addAdminToDB(Number(userId), displayName);
            userRequests[userId] ||= {};
            userRequests[userId].username = displayName;

            await bot.sendMessage(msg.chat.id, MESSAGES.ADMIN_ADDED(displayName)); 
        } catch (err) {
            console.error('Ошибка назначения админа:', err);
            try {
                await bot.sendMessage(msg.chat.id, '❌ Не удалось обработать запрос. Проверьте правильность данных.');
            } catch (sendErr) {
                console.error('Ошибка отправки сообщения об ошибке:', sendErr);
            }
        }
    });

    // /unadmin
    bot.onText(/^\/unadmin(?:\s(.+))?$/, async (msg, match) => {
        if (!msg || !msg.from || !msg.from.id || !msg.chat || !msg.chat.id) return; // 🛑 FIX: Добавлена проверка

        const fromId = msg.from.id;

        if (!botAdmins.has(Number(fromId))) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.NO_PERMISSIONS); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const target = match[1]?.trim();
        if (!target) {
            try {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/unadmin <id|@username>')); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        try {
            let userId = null;
            let displayName = null;

            const targetAsNumber = Number(target);

            if (!isNaN(targetAsNumber)) {
                userId = targetAsNumber;
                displayName = userRequests[userId]?.username || `ID: ${userId}`;
            } else if (target.startsWith('@')) {
                const usernameQuery = target.slice(1);
                const response = await fetch(
                    `http://c14.play2go.cloud:20028/api/user?username=${encodeURIComponent(usernameQuery)}`
                );

                if (!response.ok) {
                    await bot.sendMessage(msg.chat.id, `❌ Ошибка API: ${response.status}`);
                    return;
                }

                const data = await response.json();
                const userData = data?.user || (Array.isArray(data) && data[0]) || data;

                if (!userData?.id) {
                    await bot.sendMessage(msg.chat.id, MESSAGES.USER_NOT_FOUND); 
                    return;
                }

                userId = Number(userData.id);
                displayName = userData.username ? `@${userData.username}` : userData.first_name || target;
            } else {
                await bot.sendMessage(msg.chat.id, MESSAGES.INVALID_USAGE('/unadmin <id|@username>'));
                return;
            }

            if (userId === MAIN_ADMIN_ID) {
                await bot.sendMessage(msg.chat.id, MESSAGES.CANNOT_UNADMIN_MAIN); 
                return;
            }

            if (!botAdmins.has(Number(userId))) {
                await bot.sendMessage(msg.chat.id, MESSAGES.USER_NOT_ADMIN); 
                return;
            }

            botAdmins.delete(Number(userId));
            removeAdminFromDB(Number(userId));

            await bot.sendMessage(msg.chat.id, MESSAGES.ADMIN_REMOVED(displayName)); 
        } catch (err) {
            console.error('Ошибка снятия админа:', err);
            try {
                await bot.sendMessage(msg.chat.id, '❌ Не удалось обработать запрос. Проверьте правильность данных.');
            } catch (sendErr) {
                console.error('Ошибка отправки сообщения об ошибке:', sendErr);
            }
        }
    });

    // /admins
    bot.onText(/^\/admins$/, async (msg) => {
        if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) return; // 🛑 FIX: Добавлена проверка

        const chatId = msg.chat.id;
        const fromId = msg.from.id;

        if (!botAdmins.has(Number(fromId))) {
            try {
                await bot.sendMessage(chatId, MESSAGES.NO_PERMISSIONS); 
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const coderName = `[${CODER_USERNAME}](tg://user?id=${MAIN_ADMIN_ID})`; 

        const otherAdmins = [...botAdmins]
            .filter(id => id !== MAIN_ADMIN_ID)
            .map(id => {
                const user = userRequests[id] || {};
                const username = user.username || `ID:${id}`;
                return `[${username}](tg://user?id=${id})`;
            });

        let response = `👑 *Кодер:*\n${coderName}\n\n🛡 *Админы:*\n`;
        response += otherAdmins.length ? otherAdmins.join('\n') : '— Нет админов —';

        try {
            await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
    });

    // /help 
    bot.onText(/^\/help$/, async (msg) => {
        if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) return; // 🛑 FIX: Добавлена проверка

        const chatId = msg.chat.id;
        const fromId = msg.from.id;

        if (chatId.toString() !== adminChatId.toString() || !botAdmins.has(fromId)) {
            return;
        }

        const helpText = 
            `🤖 *Справка по командам бота:*\n\n` +
            `*--- 👨‍💻 Команды для Админов ---*\n` +
            `*/help* — Показать это сообщение.\n` +
            `*/getchatid* — Показать ID текущего чата.\n` +
            `*/stats* — Показать общую статистику бота.\n` +
            `*/get <ID/@username>* — Получить/обновить данные пользователя и управление блокировками.\n` +
            `*/admin <ID/@username>* — Назначить администратора.\n` +
            `*/unadmin <ID/@username>* — Снять права администратора.\n` +
            `*/admins* — Показать список всех администраторов.\n` +
            `*/tickets* — Показать список активных тикетов.\n` +
            `*/requests* — Показать список активных запросов.\n` + // <-- ОБНОВЛЕНО
            `*/aticket <ID>* — Ответить на конкретный тикет (ID берется из /tickets).\n` +
            `*/broadcast* — Начать рассылку текстового сообщения всем пользователям бота.\n` +
            `*/cancel* — Отменить активное действие администратора (например, ввод причины отклонения или сообщения для рассылки).\n\n` +
            `*--- 👤 Команды для Пользователей ---*\n` +
            `*/start* — Приветствие и главное меню.\n` +
            `*/ticket* — Начать отправку тикета (запроса в техподдержку).\n`;

        try {
            await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
        } catch (err) {
            console.error('Ошибка отправки сообщения /help:', err);
        }
    });


    // /tickets
    bot.onText(/^\/tickets$/, async (msg) => {
        if (!await checkAdminAndChat(msg)) return;

        const ticketIds = Object.keys(tickets);
        
        if (ticketIds.length === 0) {
            return bot.sendMessage(msg.chat.id, MESSAGES.NO_ACTIVE_TICKETS);
        }

        const list = ticketIds.map(id => {
            const ticket = tickets[id];
            const username = escapeMarkdown(ticket.username || `ID:${ticket.userId}`);
            const date = new Date(ticket.timestamp).toLocaleTimeString('ru-RU');
            return `*№${id}* [${username}](tg://user?id=${ticket.userId}) \`(${date})\``;
        }).join('\n');

        // === ДОБАВЛЕНО: Кнопки для просмотра содержимого ===
        const buttons = ticketIds.map(id => ({ 
            text: `🎫 Тикет №${id}`, 
            callback_data: `showTicket_${id}` // Новая команда
        }));

        const keyboardRows = [];
        for (let i = 0; i < buttons.length; i += 3) { // 3 кнопки в ряд
            keyboardRows.push(buttons.slice(i, i + 3));
        }
        // =================================================

        const text = `🎫 *Активные тикеты (${ticketIds.length}):*\n\n${list}\n\n` + 
                     `Для ответа используйте: \`/aticket <ID>\``;

        try {
            await bot.sendMessage(msg.chat.id, text, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboardRows } // Передаем кнопки
            });
        } catch (err) {
            console.error('Ошибка отправки /tickets:', err);
        }
    });

    // ДОБАВЛЕНО: /requests
    bot.onText(/^\/requests$/, async (msg) => {
        if (!await checkAdminAndChat(msg)) return;

        const requestIds = Object.keys(requestsQueue);
        
        if (requestIds.length === 0) {
            return bot.sendMessage(msg.chat.id, MESSAGES.NO_ACTIVE_REQUESTS); 
        }

        const list = requestIds.map(id => {
            const req = requestsQueue[id];
            const username = escapeMarkdown(req.username || `ID:${req.userId}`);
            const date = new Date(req.timestamp).toLocaleTimeString('ru-RU');
            return `*№${id}* [${username}](tg://user?id=${req.userId}) \`(${date})\``;
        }).join('\n');

        // === ДОБАВЛЕНО: Кнопки для просмотра содержимого ===
        const buttons = requestIds.map(id => ({ 
            text: `📨 Запрос №${id}`, 
            callback_data: `showRequest_${id}` // Новая команда
        }));

        const keyboardRows = [];
        for (let i = 0; i < buttons.length; i += 3) { // 3 кнопки в ряд
            keyboardRows.push(buttons.slice(i, i + 3));
        }
        // =================================================

        const text = `📨 *Активные запросы (${requestIds.length}):*\n\n${list}\n\n` + 
                     `Запросы обрабатываются через inline-кнопки в самом сообщении.`;

        try {
            await bot.sendMessage(msg.chat.id, text, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboardRows } // Передаем кнопки
            });
        } catch (err) {
            console.error('Ошибка отправки /requests:', err);
        }
    });


    // /broadcast  
bot.onText(/^\/broadcast$/, async (msg) => {
    // 🛑 ИСПРАВЛЕНИЕ: Проверка на существование msg, msg.chat, msg.chat.id и msg.from.id
    if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) return; 

    const chatId = msg.chat.id;
    const fromId = msg.from.id;

    if (!botAdmins.has(Number(fromId))) {
        try {
            await bot.sendMessage(chatId, MESSAGES.NO_PERMISSIONS); 
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
        return;
    }
    
    // **🛑 ИСПРАВЛЕНИЕ НАДЕЖНОСТИ (ОСНОВНОЕ):** Добавить проверку adminChatId
    if (!adminChatId) {
        console.error("ADMIN_CHAT_ID не установлен! Команда /broadcast не может быть выполнена.");
        try {
            await bot.sendMessage(chatId, "❌ Ошибка конфигурации: ID чата администратора не установлен.");
        } catch (err) { /* ignore */ }
        return;
    }

    // Использовать String() для сравнения
    if (String(chatId) !== String(adminChatId)) return; 

    broadcastSession[fromId] = true;
        try {
            await bot.sendMessage(chatId, MESSAGES.BROADCAST_PROMPT);
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
    });
    

    // /cancel 
    bot.onText(/^\/cancel$/, async (msg) => {
        // 🛑 ИСПРАВЛЕНИЕ: Проверка на существование msg, msg.chat, msg.chat.id и msg.from.id
        if (!msg || !msg.chat || !msg.chat.id || !msg.from || !msg.from.id) return; 

        const chatId = msg.chat.id;
        const fromId = msg.from.id;;

        // 🛑 ИСПРАВЛЕНИЕ НАДЕЖНОСТИ
        if (!adminChatId) return; 
        
        if (String(chatId) !== String(adminChatId) || !botAdmins.has(fromId)) {
            return;
        }

        // Проверяем все активные сессии
        if (rejectSessions[fromId] || adminMessageSessions[fromId] || broadcastSession[fromId]) {
            delete rejectSessions[fromId];
            delete adminMessageSessions[fromId];
            delete broadcastSession[fromId];
            try {
                await bot.sendMessage(chatId, MESSAGES.CANCEL_SUCCESS);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
        } else {
            try {
                await bot.sendMessage(chatId, MESSAGES.NO_ACTIVE_SESSION);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
        }
    });
};