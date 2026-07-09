/**
 * In-Memory Chat Storage (для разработки)
 * В продакшене будет заменено на API вызовы
 */

export const chatStore = {
    // Структура: { chatId: { messages: [], lastMessageId: 0 } }
    chats: {},

    getChat(chatId) {
        if (!this.chats[chatId]) {
            this.chats[chatId] = { messages: [], lastMessageId: 0 };
        }
        return this.chats[chatId];
    },

    addMessage(chatId, text, isOutgoing = false) {
        const chat = this.getChat(chatId);
        const id = ++chat.lastMessageId;
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const message = {
            id,
            text,
            isOutgoing,
            time,
            timestamp: now.getTime()
        };

        chat.messages.push(message);
        return message;
    },

    getMessages(chatId) {
        return this.getChat(chatId).messages;
    },

    clear() {
        this.chats = {};
    }
};