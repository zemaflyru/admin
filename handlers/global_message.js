// handlers/global_message.js (Обработка текстовых сообщений, не являющихся командами)

const { rejectSessions, adminMessageSessions, broadcastSession, requestsQueue } = require('../sessions'); // <-- ОБНОВЛЕНО: добавлен broadcastSession
const { getAllUserIds } = require('../db'); // <-- ДОБАВЛЕНО
const { 
    MESSAGES, 
    MAIN_MENU_KEYBOARD, 
    RULES_KEYBOARD,
    CODER_ID
} = require('../messages/texts'); // <-- ДОБАВЛЕНО

module.exports = (bot, botAdmins, userRequests, rejectSessions, adminMessageSessions, adminChatId) => {
    bot.on('message', async (msg) => {
        const userId = msg.from.id;

        // Игнорируем команды и сообщения из групп, если это не пересылка админу
        if (msg.text && msg.text.startsWith('/')) return;

        // 1. Обработка причины отклонения запроса
        if (botAdmins.has(userId) && rejectSessions[userId]) {
            const reqId = rejectSessions[userId];
            
            // Используем requestsQueue из импорта, а не из require внутри
            const req = requestsQueue[reqId]; 

            if (!req) {
                delete rejectSessions[userId];
                // Используем MESSAGES
                return bot.sendMessage(userId, '❌ Этот запрос уже обработан.'); 
            }

            const reason = msg.text || '(без причины)';
            const targetUserId = req.userId;
            const adminName = userRequests[userId]?.username || `ID: ${userId}`;
            const mainAdminName = userRequests[CODER_ID]?.username || `ID: ${CODER_ID}`;

            try {
                // ИСПОЛЬЗУЕМ MESSAGES
                await bot.sendMessage(targetUserId, MESSAGES.REJECT_USER_NOTIFY(reason));
                
                // Форматируем сообщение для админ-чата, используя ID кодера для ссылки, как в `texts.js`
                await bot.sendMessage(adminChatId, 
                    `❌ Запрос #${reqId} отклонён админом [${adminName}](tg://user?id=${userId}) по причине: ${reason}`, 
                    { parse_mode: 'Markdown' });
            } catch (err) {
                console.error('Ошибка отправки сообщений об отклонении:', err);
            }

            delete requestsQueue[reqId];
            delete rejectSessions[userId];
            return;
        }

        // 2. Обработка сообщений админов для пересылки пользователю
        if (botAdmins.has(userId) && adminMessageSessions[userId]) {
            const targetUserId = adminMessageSessions[userId];
            const targetUser = userRequests[targetUserId];

            if (!targetUser) {
                delete adminMessageSessions[userId];
                // Используем MESSAGES
                return bot.sendMessage(adminChatId, MESSAGES.USER_NOT_FOUND); 
            }
            
            // Проверяем, что это только текст
            if (!msg.text) {
                 return bot.sendMessage(adminChatId, '⚠️ Можно отправлять только текстовые сообщения пользователю.');
            }

            try {
                // ИСПОЛЬЗУЕМ MESSAGES
                await bot.sendMessage(targetUserId, MESSAGES.MESSAGE_FROM_ADMIN + msg.text);
                await bot.sendMessage(adminChatId, `✅ Сообщение успешно отправлено пользователю ${targetUser.username}:\n\n${msg.text}`);
            } catch (err) {
                console.error('Ошибка отправки сообщения пользователю:', err);
                await bot.sendMessage(adminChatId, `❌ Не удалось отправить сообщение пользователю ${targetUser.username} (вероятно, он заблокировал бота).`);
            }

            delete adminMessageSessions[userId];
            return;
        }
        
        // 3. Обработка рассылки (Broadcast) <-- ДОБАВЛЕНО
        if (botAdmins.has(userId) && broadcastSession[userId]) {
            delete broadcastSession[userId]; // Сразу удаляем сессию
            const messageText = msg.text;

            if (!messageText) {
                return bot.sendMessage(adminChatId, MESSAGES.BROADCAST_TEXT_ONLY);
            }

            getAllUserIds(async (err, userIds) => {
                if (err) {
                    return bot.sendMessage(adminChatId, '❌ Ошибка БД при получении списка пользователей для рассылки.');
                }

                let successCount = 0;
                let failCount = 0;

                for (const targetId of userIds) {
                    if (targetId === userId) continue; // Не отправляем рассылку самому себе
                    
                    try {
                        await bot.sendMessage(targetId, messageText);
                        successCount++;
                    } catch (e) {
                        failCount++;
                        // Ошибка, если пользователь заблокировал бота
                    }
                }

                await bot.sendMessage(adminChatId, `✅ Рассылка завершена!\n\n` +
                    `Отправлено успешно: ${successCount}\n` +
                    `Не удалось (бот заблокирован/ошибка): ${failCount}`);
            });
            return;
        }

        // 4. Отправка меню, если нет активного действия
        if (msg.chat.type !== 'private') return;

        const user = userRequests[userId] ||= {
            acknowledgedRules: false,
            blocked: false,
            ticketBlocked: false,
            selectedAction: null,
            userId,
            username: msg.from.username ? `@${msg.from.username}` : msg.from.first_name
        };

        if (!user.selectedAction) {
            // ИСПОЛЬЗУЕМ КОНСТАНТЫ
            const keyboard = user.acknowledgedRules ? MAIN_MENU_KEYBOARD : RULES_KEYBOARD; 

            try {
                await bot.sendMessage(userId, MESSAGES.MENU_PROMPT, { reply_markup: keyboard });
            } catch (err) {
                console.error('Ошибка отправки меню:', err);
            }
        }
    });
};