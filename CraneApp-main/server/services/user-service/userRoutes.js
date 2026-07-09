const express = require('express');
const router = express.Router();
const userController = require('./userController');

// ============================================
// МАРШРУТЫ ПОЛЬЗОВАТЕЛЕЙ
// ============================================

// Получить текущий профиль
router.get('/me', (req, res) => {
  userController.getMe(req, res);
});

// Обновить профиль
router.put('/me', (req, res) => {
  userController.updateProfile(req, res);
});

// Получить пользователя по ID
router.get('/:id', (req, res) => {
  userController.getUser(req, res);
});

// Получить контакты
router.get('/contacts/list', (req, res) => {
  userController.getContacts(req, res);
});

// Добавить контакт
router.post('/contacts/add', (req, res) => {
  userController.addContact(req, res);
});

// Заблокировать пользователя
router.post('/block', (req, res) => {
  userController.blockUser(req, res);
});

// Разблокировать пользователя
router.post('/unblock', (req, res) => {
  userController.unblockUser(req, res);
});

// Получить заблокированных
router.get('/blocked', (req, res) => {
  userController.getBlockedUsers(req, res);
});

// Поиск пользователей
router.get('/search', (req, res) => {
  userController.searchUsers(req, res);
});

// Получить все настройки
router.get('/all-settings', (req, res) => {
  userController.getAllSettings(req, res);
});

// Обновить все настройки
router.put('/all-settings', (req, res) => {
  userController.updateAllSettings(req, res);
});

// Удалить аккаунт
router.delete('/account', (req, res) => {
  userController.deleteAccount(req, res);
});

// ============================================
// ЭКСПОРТ — ТОЛЬКО ROUTER
// ============================================

module.exports = router;