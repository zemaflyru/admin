// db.js

const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database(process.env.DB_PATH || './bot_data.db');
const MAIN_ADMIN_ID = 774756964;
const MAIN_ADMIN_USERNAME = '@zoomflyru';

// --- Функции для Админов ---

function addAdminToDB(userId, username) {
    db.run(
        `INSERT OR REPLACE INTO admins (user_id, username) VALUES (?, ?)`,
        [userId, username],
        err => {
            if (err) console.error('Ошибка при добавлении админа в БД:', err);
        }
    );
}

function removeAdminFromDB(userId) {
    db.run(`DELETE FROM admins WHERE user_id = ?`, [userId], err => {
        if (err) console.error('Ошибка при удалении админа из БД:', err);
    });
}

// --- Функции для Пользователей ---

function upsertUserToDB(user) {
    db.run(
        `INSERT INTO users (user_id, username, blocked, ticket_blocked)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
            username = excluded.username,
            blocked = excluded.blocked,
            ticket_blocked = excluded.ticket_blocked`,
        [user.userId, user.username, user.blocked ? 1 : 0, user.ticketBlocked ? 1 : 0],
        err => {
            if (err) console.error('Ошибка сохранения пользователя в БД:', err);
        }
    );
}

function getAllUserIds(callback) { // <-- ДОБАВЛЕНО
    db.all(`SELECT user_id FROM users`, [], (err, rows) => {
        if (err) {
            console.error('Ошибка при получении всех ID пользователей:', err);
            return callback(err);
        }
        callback(null, rows.map(row => row.user_id));
    });
}

// --- Инициализация и Загрузка ---

function initDB(botAdmins) {
    db.serialize(() => {
        // Создаём таблицу для админов
        db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                user_id INTEGER PRIMARY KEY,
                username TEXT
            )
        `);
        // Создаём таблицу для пользователей
        db.run(`
            CREATE TABLE IF NOT EXISTS users (
                user_id INTEGER PRIMARY KEY,
                username TEXT,
                blocked INTEGER DEFAULT 0,
                ticket_blocked INTEGER DEFAULT 0
            )
        `);
    });
}

function loadAdminsAndUsers(userRequests, botAdmins) {
    // Загружаем админов из БД при старте
    db.all(`SELECT * FROM admins`, [], (err, rows) => {
        if (err) return console.error('Ошибка загрузки админов из БД:', err);
        rows.forEach(row => botAdmins.add(row.user_id));
        console.log(`✅ Загружено администраторов: ${rows.length}`);

        // Добавляем главного админа, если его нет в БД
        if (!botAdmins.has(MAIN_ADMIN_ID)) {
            botAdmins.add(MAIN_ADMIN_ID);
            addAdminToDB(MAIN_ADMIN_ID, MAIN_ADMIN_USERNAME);
        }
    });

    // Загружаем всех пользователей из БД при старте
    db.all(`SELECT * FROM users`, [], (err, rows) => {
        if (err) return console.error('Ошибка загрузки пользователей из БД:', err);
        rows.forEach(row => {
            userRequests[row.user_id] = {
                userId: row.user_id,
                username: row.username,
                blocked: !!row.blocked,
                ticketBlocked: !!row.ticket_blocked,
                acknowledgedRules: false, // Предполагаем false при старте, нужно обновить при /start
                selectedAction: null,
                timestamp: 0,
                ticketTimestamp: 0
            };
        });
        console.log(`✅ Загружено пользователей из БД: ${rows.length}`);
    });
}

module.exports = {
    db,
    initDB,
    loadAdminsAndUsers,
    addAdminToDB,
    removeAdminFromDB,
    upsertUserToDB,
    getAllUserIds // <-- ЭКСПОРТ ДОБАВЛЕН
};