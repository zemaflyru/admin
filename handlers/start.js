// handlers/start.js

const { upsertUserToDB } = require('../db');

module.exports = (bot, botAdmins, userRequests, adminChatId) => {
    bot.onText(/^\/start$/, async (msg) => {
        if (msg.chat.type !== 'private') return;

        const id = msg.from.id;
        const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
        const isNewUser = !userRequests[id];

        userRequests[id] ||= {
            acknowledgedRules: false,
            blocked: false,
            ticketBlocked: false,
            timestamp: 0,
            ticketTimestamp: 0,
            selectedAction: null,
            userId: id,
            username
        };
        const user = userRequests[id];

        const photoUrl = 'https://image.winudf.com/v2/image/bW9iaS5hbmRyb2FwcC5wcm9zcGVyaXR5YXBwcy5jNTExMV9zY3JlZW5fN18xNTI0MDQxMDUwXzAyMQ/screen-7.jpg?fakeurl=1&type=.jpg';

        try {
            if (isNewUser) {
                await bot.sendMessage(adminChatId, `👤 Пользователь ${username} успешно прошел авторизацию в боте!`);
            }
        } catch (err) {
            console.error('Ошибка отправки уведомления админу:', err);
        }

        if (botAdmins.has(Number(id))) {
            user.acknowledgedRules = true; // Админ автоматически ознакомлен

            try {
                await bot.sendPhoto(id, photoUrl, { caption: `👋 Привет, ${username}! Вы вошли как администратор.` });

                const adminKeyboard = {
                    inline_keyboard: [
                        [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
                        [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
                    ]
                };
                await bot.sendMessage(id, `Выберите действие:`, { reply_markup: adminKeyboard });
            } catch (err) {
                console.error('Ошибка отправки сообщения админу:', err);
            }
            return;
        }

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

        try {
            await bot.sendPhoto(id, photoUrl, { caption: `👋 Привет, ${username}! Добро пожаловать!` });
            await bot.sendMessage(id, `👋 Выберите действие:`, { reply_markup: keyboard });
        } catch (err) {
            console.error('Ошибка отправки приветственного сообщения:', err);
        }

        upsertUserToDB(user);
    });
};