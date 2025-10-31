// messages/texts.js

// --- Глобальные Константы ---
const RULES_URL = 'https://telegra.ph/Pravila-nashej-gruppy-10-01';
const CODER_ID = 774756964;
const CODER_USERNAME = '@zoomflyru';
const PHOTO_URL = 'https://image.winudf.com/v2/image/bW9iaS5hbmRyb2FwcC5wcm9zcGVyaXR5YXBwcy5jNTExMV9zY3JlZW5fN18xNTI0MDQxMDUwXzAyMQ/screen-7.jpg?fakeurl=1&type=.jpg';

// --- Клавиатуры ---

const MAIN_MENU_KEYBOARD = {
    inline_keyboard: [
        [{ text: '📨 Отправить запрос', callback_data: 'menu_request' }],
        [{ text: '🎫 Отправить тикет', callback_data: 'menu_ticket' }]
    ]
};

const RULES_KEYBOARD = {
    inline_keyboard: [
        [{ text: '📖 Ознакомиться с правилами', url: RULES_URL }],
        [{ text: '✅ Ознакомился', callback_data: 'ack_rules' }]
    ]
};

/**  * Генерирует клавиатуру для команды /get. 
 * ОБНОВЛЕНО: Добавлен userId для callback_data.
 */
function generateAdminKeyboard(isBlocked, isTicketBlocked, userId) {
    return {
        inline_keyboard: [
            [
                {
                    text: isBlocked ? '🔓 Разблокировать запросы' : '🔒 Заблокировать запросы',
                    callback_data: `toggleBlockReq_${userId}` // <-- ОБНОВЛЕНО
                },
                {
                    text: isTicketBlocked ? '🔓 Разблокировать тикеты' : '🔒 Заблокировать тикеты',
                    callback_data: `toggleBlockTicket_${userId}` // <-- ОБНОВЛЕНО
                }
            ],
            [
                {
                    text: '✉️ Написать пользователю',
                    callback_data: `writeUser_${userId}` // <-- ОБНОВЛЕНО
                }
            ]
        ]
    };
}

// --- Сообщения ---

const MESSAGES = {
    START_AUTH_SUCCESS: (username) => `👤 Пользователь ${username} успешно прошел авторизацию в боте!`,
    START_WELCOME: (username) => `👋 Привет, ${username}! Добро пожаловать!`,
    START_ADMIN_WELCOME: (username) => `👋 Привет, ${username}! Вы вошли как администратор.`,
    MENU_PROMPT: `👋 Выберите действие:`,
    ACK_SUCCESS: `✅ Отлично! Теперь вы можете отправлять запросы и тикеты.`,

    // Request/Ticket
    REQUEST_PROMPT: '📨 Отправьте сообщение (текст, фото, видео, документ) для запроса.',
    TICKET_PROMPT: '📸 Отправьте сообщение для тикета (можете прикрепить фото, видео или документ, а также добавить подпись).',
    TICKET_BLOCKED: '🚫 Вы заблокированы и не можете отправлять тикеты.',
    REQUEST_BLOCKED: '🚫 Вы заблокированы и не можете отправлять запросы.',
    TICKET_COOLDOWN: (remaining) => `⏱ Подождите ${remaining} секунд перед новым тикетом.`,
    REQUEST_COOLDOWN: (remaining) => `⏱ Подождите ${remaining} секунд перед новым запросом.`,
    NOT_IN_GROUP_REQUEST: `📌 Подпишитесь на группу для отправки запроса.`,
    NOT_IN_GROUP_TICKET: `📌 Подпишитесь на группу, чтобы отправить тикет.`,
    REQUEST_SENT: (id) => `✅ Ваш запрос #${id} отправлен администрации.`,
    TICKET_SENT: (id) => `✅ Ваш тикет #${id} отправлен администрации.`,

    // Admin
    NO_PERMISSIONS: '❌ У вас нет прав для выполнения этой команды.',
    INVALID_USAGE: (command) => `⚠️ Использование: ${command}`,
    TICKET_NOT_FOUND: '❌ Тикет не найден.',
    NO_ACTIVE_TICKETS: '📭 Нет активных тикетов.',
    NO_ACTIVE_REQUESTS: '📭 Нет активных запросов.', // <-- ДОБАВЛЕНО
    USER_NOT_FOUND: '❌ Пользователь не найден.',
    USER_NOT_ADMIN: '❌ Этот пользователь не является администратором.',
    ADMIN_ADDED: (username) => `✅ Пользователь ${username} назначен администратором.`,
    ADMIN_REMOVED: (username) => `✅ Пользователь ${username} снят с прав администратора.`,
    CANNOT_UNADMIN_MAIN: '⚠️ Нельзя снять главного администратора.',
    
    // Admin Actions
    WRITE_USER_PROMPT: (username) => `✉️ Отправьте сообщение для пользователя ${username}.`,
    REJECT_PROMPT: (adminName, reqId, adminId) => `✏️ Админ [${adminName}](tg://user?id=${adminId}) нажал отклонить запрос #${reqId}. Напишите причину:`, // <-- ОБНОВЛЕНО
    MESSAGE_FROM_ADMIN: '✉️ Сообщение от администратора:\n\n',
    REJECT_USER_NOTIFY: (reason) => `❌ Ваш запрос отклонён администрацией по причине: ${reason}`,
    BROADCAST_PROMPT: '📣 Отправьте сообщение, которое нужно разослать всем пользователям:',
    BROADCAST_TEXT_ONLY: '⚠️ Рассылка может быть только текстовой. Попробуйте снова.',
    CANCEL_SUCCESS: '✅ Действие отменено.',
    NO_ACTIVE_SESSION: 'ℹ️ Нет активных действий для отмены.',
};

module.exports = {
    MESSAGES,
    MAIN_MENU_KEYBOARD,
    RULES_KEYBOARD,
    generateAdminKeyboard,
    RULES_URL,
    CODER_ID,
    CODER_USERNAME,
    PHOTO_URL
};