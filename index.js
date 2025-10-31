// index.js (Главный файл)

require('dotenv').config();

// --- Инициализация и настройка ---
const TelegramBot = require('node-telegram-bot-api');
const { botAdmins, userRequests, tickets, requestsQueue, rejectSessions, adminMessageSessions } = require('./sessions');
const { initDB, loadAdminsAndUsers } = require('./db');
const { isAdminAction } = require('./utils');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Инициализация базы данных и загрузка данных
initDB(botAdmins);
loadAdminsAndUsers(userRequests, botAdmins);

// --- Импорт обработчиков ---
const registerStartHandler = require('./handlers/start');
const registerAdminTools = require('./handlers/admin_tools');
const registerTicketHandlers = require('./handlers/ticket');
const registerMessageProcessor = require('./handlers/message_processor');
const registerCallbackQuery = require('./handlers/callback_query');
const registerGlobalMessageHandler = require('./handlers/global_message');

// --- Регистрация обработчиков ---

// 1. Команды /start и основное меню
registerStartHandler(bot, botAdmins, userRequests, process.env.ADMIN_CHAT_ID);

// 2. Инструменты администратора
// ОБНОВЛЕНО: Добавлены tickets и requestsQueue
registerAdminTools(bot, botAdmins, userRequests, tickets, requestsQueue, process.env.ADMIN_CHAT_ID, process.env.GROUP_CHAT_ID);

// 3. Обработчики тикетов
registerTicketHandlers(bot, botAdmins, userRequests, tickets, process.env.ADMIN_CHAT_ID);

// 4. Основной процессор сообщений (для ожидания тикета/запроса)
registerMessageProcessor(bot, userRequests, tickets, requestsQueue, process.env.ADMIN_CHAT_ID, process.env.GROUP_CHAT_ID);

// 5. Обработчик inline-кнопок
registerCallbackQuery(bot, botAdmins, userRequests, requestsQueue, tickets, rejectSessions, adminMessageSessions, process.env.ADMIN_CHAT_ID, process.env.GROUP_CHAT_ID);

// 6. Глобальный обработчик сообщений (для пересылки админам и меню, когда selectedAction === null)
registerGlobalMessageHandler(bot, botAdmins, userRequests, rejectSessions, adminMessageSessions, process.env.ADMIN_CHAT_ID);


console.log('✅ Бот запущен успешно! Ожидание сообщений...');

// Экспортируем константы для доступа из модулей
module.exports = {
    bot,
    botAdmins,
    userRequests,
    tickets,
    requestsQueue,
    rejectSessions,
    adminMessageSessions,
};