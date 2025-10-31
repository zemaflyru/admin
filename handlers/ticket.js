// handlers/ticket.js

const { isUserInGroup, getInviteLink } = require('../utils');
const { tickets } = require('../sessions'); // Доступ к активным тикетам

module.exports = (bot, botAdmins, userRequests, tickets, adminChatId, groupChatId) => {
    // /ticket (для пользователя)
    bot.onText(/^\/ticket$/, async (msg) => {
        if (msg.chat.type !== 'private') return;
        const userId = msg.from.id;
        const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

        if (!userRequests[userId])
            userRequests[userId] = { acknowledgedRules: false, blocked: false, timestamp: 0, ticketTimestamp: 0, userId, username };

        const user = userRequests[userId];

        if (user.ticketBlocked) {
            try {
                await bot.sendMessage(userId, '🚫 Вы заблокированы и не можете отправлять тикеты.');
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        if (!user.acknowledgedRules) {
            try {
                await bot.sendMessage(userId, '⚠️ Сначала ознакомьтесь с правилами через /start.');
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const now = Date.now();
        if (user.ticketTimestamp && now - user.ticketTimestamp < 60000) {
            const remaining = Math.ceil((60000 - (now - user.ticketTimestamp)) / 1000);
            try {
                await bot.sendMessage(userId, `⏱ Подождите ${remaining} секунд перед новым тикетом.`);
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const subscribed = await isUserInGroup(bot, groupChatId, userId);
        if (!subscribed) {
            const inviteLink = await getInviteLink(bot, groupChatId);
            try {
                await bot.sendMessage(userId, '📌 Подпишитесь на группу, чтобы отправить тикет.', {
                    reply_markup: { inline_keyboard: [[{ text: '➡️ Подписаться', url: inviteLink }]] }
                });
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        try {
            await bot.sendMessage(userId, '📸 Отправьте сообщение для тикета (можете прикрепить фото, видео или документ, а также добавить подпись).');
            user.selectedAction = 'ticket_wait';
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
    });

    // /aticket (для админа)
    bot.onText(/^\/aticket (\d+) (.+)/, async (msg, match) => {
        if (!botAdmins.has(msg.from.id)) return;
        if (msg.chat.id.toString() !== adminChatId.toString()) return;

        const ticketId = parseInt(match[1]);
        const replyText = match[2].trim();

        if (!tickets[ticketId]) {
            try {
                await bot.sendMessage(adminChatId, '❌ Тикет не найден.');
            } catch (err) {
                console.error('Ошибка отправки сообщения:', err);
            }
            return;
        }

        const { userId, username } = tickets[ticketId];

        try {
            await bot.sendMessage(userId, `📩 *Ответ администрации на ваш тикет #${ticketId}:*\n${replyText}`, { parse_mode: 'Markdown' });
            await bot.sendMessage(adminChatId, `✅ Ответ отправлен пользователю ${username} (${userId}) на тикет #${ticketId}.`);
            delete tickets[ticketId];
        } catch (err) {
            console.error('Ошибка отправки сообщения:', err);
        }
    });
};