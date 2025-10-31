// utils.js

const { db } = require('./db');

function isKeyboardChanged(oldKeyboard, newKeyboard) {
    if (!oldKeyboard) return true;
    return JSON.stringify(oldKeyboard) !== JSON.stringify(newKeyboard);
}

function escapeMarkdown(text) {
    if (!text) return '';
    // Экранирование символов, используемых в Markdown V1 (или основных)
    return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

// Заглушка, чтобы не требовать `bot` в этом модуле.
// Реализация будет использовать `bot.exportChatInviteLink(groupChatId)`
async function getInviteLink(bot, groupChatId) {
    try {
        return await bot.exportChatInviteLink(groupChatId);
    } catch (err) {
        console.error('Ошибка получения ссылки:', err);
        return null;
    }
}

// Заглушка, чтобы не требовать `bot` в этом модуле.
// Реализация будет использовать `bot.getChatMember(groupChatId, userId)`
async function isUserInGroup(bot, groupChatId, userId) {
    try {
        const member = await bot.getChatMember(groupChatId, userId);
        return ['member', 'administrator', 'creator'].includes(member.status);
    } catch {
        return false;
    }
}

function getUserDBStats(callback) {
    db.serialize(() => {
        db.get(`SELECT COUNT(*) AS total FROM users`, [], (err, totalRow) => {
            if (err) {
                console.error('Ошибка при подсчёте пользователей:', err);
                return callback(err);
            }

            db.get(`SELECT COUNT(*) AS blocked FROM users WHERE blocked = 1`, [], (err, blockedRow) => {
                if (err) {
                    console.error('Ошибка при подсчёте заблокированных:', err);
                    return callback(err);
                }
                callback(null, {
                    totalUsers: totalRow.total || 0,
                    blockedUsers: blockedRow.blocked || 0
                });
            });
        });
    });
}

module.exports = {
    isKeyboardChanged,
    escapeMarkdown,
    getInviteLink,
    isUserInGroup,
    getUserDBStats,
};