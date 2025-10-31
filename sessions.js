// sessions.js

// Глобальные хранилища данных
let botAdmins = new Set();
const userRequests = {}; // Информация о пользователях: { id: {acknowledgedRules, blocked, ticketBlocked, ...} }
let tickets = {}; // Активные тикеты: { ticketId: { userId, username, text, media } }
let requestsQueue = {}; // Активные запросы: { requestId: { userId, username, text, media } }

// Счётчики
let ticketCounter = 1;
let requestCounter = 1;

// Сессии для админов
const rejectSessions = {}; // { adminId: requestId } - ожидание причины отклонения
const adminMessageSessions = {}; // { adminId: targetUserId } - ожидание сообщения для пользователя
const broadcastSession = {}; // { adminId: true } - ожидание сообщения для рассылки

module.exports = {
    botAdmins,
    userRequests,
    tickets,
    requestsQueue,
    ticketCounter,
    requestCounter,
    rejectSessions,
    adminMessageSessions, // <-- Добавлена запятая
    broadcastSession
};