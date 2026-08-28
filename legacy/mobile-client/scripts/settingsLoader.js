// Simple renderer for the reduced settings menu
(function(){
  const sections = [
    'Профиль', 'Избранное', 'Недавние звонки', 'Устройства', 'Папки с чатами',
    'Уведомления', 'Конфиденциальность', 'Данные и память', 'Оформление', 'Энергосбережение',
    'Язык', 'CraneApp премиум', 'Помощь', 'Вопросы', 'Возможности'
  ];
  const root = document.getElementById('settingsRoot');
  if (!root) return;
  root.innerHTML = '<h2>Настройки</h2><ul>' + sections.map(s => `<li>${s}</li>`).join('') + '</ul>';
})();
