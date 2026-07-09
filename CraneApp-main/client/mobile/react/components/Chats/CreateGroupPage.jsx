import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../../../application/services/serviceContainer.js';
import { ToastStack } from '../common/ToastStack.jsx';
import { useToasts } from '../../hooks/useToasts.js';

export function CreateGroupPage({ t = (k, f) => f }) {
  const navigate = useNavigate();
  const { toasts, showToast } = useToasts();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  async function handleSearch(val) {
    setSearchQuery(val);
    const cleanVal = val.trim().replace('@', '');
    if (cleanVal.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const users = await services.chatService.searchUsers(cleanVal);
      setSearchResults(users);
    } catch (_) {
      // Игнорируем ошибки поиска в фоне
    }
  }

  function toggleMember(user) {
    if (selectedMembers.some(m => m.id === user.id)) {
      setSelectedMembers(selectedMembers.filter(m => m.id !== user.id));
    } else {
      setSelectedMembers([...selectedMembers, user]);
    }
  }

  async function handleCreateGroup() {
    if (!title.trim()) {
      showToast('error', 'Введите название группы', '⚠️');
      return;
    }
    if (selectedMembers.length === 0) {
      showToast('error', 'Выберите хотя бы одного участника', '⚠️');
      return;
    }

    setIsCreating(true);
    try {
      const members = selectedMembers.map(m => m.id);
      const data = await services.chatService.createGroup({ title, description, members });
      if (data.chatId) {
        showToast('success', 'Группа успешно создана!', '🎉');
        setTimeout(() => {
          navigate(`/chats/${encodeURIComponent(data.chatId)}`);
        }, 800);
      } else {
        throw new Error(data.error || 'Не удалось создать группу');
      }
    } catch (err) {
      showToast('error', err.message, '❌');
      setIsCreating(false);
    }
  }

  return (
    <main className="create-group-page">
      <ToastStack toasts={toasts} />
      <header className="create-group-header">
        <button className="back-arrow-btn" onClick={() => navigate('/chats')}>
          ‹
        </button>
        <h1>{t('newGroup', 'Новая группа')}</h1>
      </header>

      <section>
        <input
          type="text"
          className="group-name-input"
          placeholder={t('groupTitlePlaceholder', 'Название группы')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={50}
        />

        <input
          type="text"
          className="group-desc-input"
          placeholder={t('groupDescPlaceholder', 'Описание (необязательно)')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={255}
        />
      </section>

      <section style={{ marginBottom: 20 }}>
        <h3>{t('addMembers', 'Добавить участников')}</h3>
        <input
          type="search"
          className="contacts-search-input"
          placeholder={t('searchUsers', 'Поиск по юзернейму...')}
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
        />

        <div className="contacts-select-list">
          {searchResults.map((user) => {
            const isChecked = selectedMembers.some(m => m.id === user.id);
            const initials = (user.firstName || user.username || '?').charAt(0).toUpperCase();

            return (
              <div key={user.id} className="contact-item-row" onClick={() => toggleMember(user)}>
                <div className="contact-left">
                  <div className="contact-avatar-circle">
                    {user.avatarUrl ? (
                      <img src={user.avatarUrl} alt="" />
                    ) : (
                      <span>{initials}</span>
                    )}
                  </div>
                  <div className="contact-details">
                    <span className="contact-name-title">{user.firstName || 'Пользователь'}</span>
                    <span className="contact-username-sub">@{user.username}</span>
                  </div>
                </div>
                <input
                  type="checkbox"
                  className="contact-select-checkbox"
                  checked={isChecked}
                  onChange={() => {}} // Обрабатывается кликом по строке
                />
              </div>
            );
          })}
        </div>
      </section>

      {selectedMembers.length > 0 && (
        <section className="selected-members-section">
          <h4>Выбрано ({selectedMembers.length}):</h4>
          <div className="selected-members-list">
            {selectedMembers.map(m => (
              <div
                key={m.id}
                onClick={() => toggleMember(m)}
                className="selected-member-pill"
              >
                <span>{m.firstName || m.username}</span>
                <span className="remove-pill">✕</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <button
        className="create-group-btn"
        disabled={isCreating || !title.trim() || selectedMembers.length === 0}
        onClick={handleCreateGroup}
      >
        {isCreating ? t('creating', 'Создание...') : t('createGroupAction', 'Создать группу')}
      </button>
    </main>
  );
}
