require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.BOT_TOKEN;
const bot = new TelegramBot(token, { polling: true });

// Команда !гет
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (!text) return;

    if (text.trim() === '!гет') {
        const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;
        bot.sendMessage(chatId, `👤 Username: ${username}\n🆔 Chat ID: ${chatId}`);
    }
});