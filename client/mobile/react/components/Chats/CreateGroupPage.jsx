import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { services } from '../../services/serviceContainer.js';
import { ToastStack } from '../ui/ToastStack.jsx';
import { useToasts } from '../../hooks/useToasts.js';
import '../../styles/CreateGroupPage.css';

export function CreateGroupPage({ t = (k, f) => f, onClose }) {
  const navigate = useNavigate();
  const { toasts, showToast } = useToasts();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedMembers, setSelectedMembers] = useState([]);
  const [isCreating, setIsCreating] = useState(false);

  const handleClose = () => {
    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };

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
    } catch (_) {}
  }

  function toggleMember(user) {
    if (selectedMembers.some((m) => m.id === user.id)) {
      setSelectedMembers(selectedMembers.filter((m) => m.id !== user.id));
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
      const members = selectedMembers.map((m) => m.id);
      const data = await services.chatService.createGroup({ title, description, members });
      if (data.chatId) {
        showToast('success', 'Группа успешно создана!', '🎉');
        setTimeout(() => {
          navigate(`/chats/${encodeURIComponent(data.chatId)}`);
          if (onClose) onClose();
        }, 400);
      } else {
        throw new Error(data.error || 'Не удалось создать группу');
      }
    } catch (err) {
      showToast('error', err.message, '❌');
      setIsCreating(false);
    }
  }

  return (
    <div className="create-group-detail-pane" onClick={handleClose}>
      <ToastStack toasts={toasts} />

      <div className="create-group-container" onClick={(e) => e.stopPropagation()}>
        <div className="create-group-header">
          <h3>{t('newGroup', 'Создание группы')}</h3>
          <button className="close-btn" onClick={handleClose}>✕</button>
        </div>

        <div className="create-group-body">
          {/* Инпуты названия и описания */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              className="glass-input-field"
              placeholder={t('groupTitlePlaceholder', 'Название группы')}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={50}
            />

            <input
              type="text"
              className="glass-input-field"
              placeholder={t('groupDescPlaceholder', 'Описание (необязательно)')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={255}
            />
          </div>

          {/* Поиск участников */}
          <div style={{ marginTop: '16px' }}>
            <div className="settings-subsection-title" style={{ marginBottom: '8px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px' }}>
              {t('addMembers', 'Добавить участников')}
            </div>
            <input
              type="search"
              className="glass-input-field"
              placeholder={t('searchUsers', 'Поиск по юзернейму...')}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              style={{ marginBottom: '12px' }}
            />

            <div className="contacts-select-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
              {searchResults.map((user) => {
                const isChecked = selectedMembers.some((m) => m.id === user.id);
                const initials = (user.firstName || user.username || '?').charAt(0).toUpperCase();

                return (
                  <div
                    key={user.id}
                    className={`glass-contact-row ${isChecked ? 'selected' : ''}`}
                    onClick={() => toggleMember(user)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div className="account-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                        {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="account-avatar" /> : initials}
                      </div>
                      <div>
                        <div className="user-name" style={{ fontSize: '14px', color: '#fff' }}>{user.firstName || 'Пользователь'}</div>
                        <div className="user-handle" style={{ fontSize: '12px', opacity: 0.6 }}>@{user.username}</div>
                      </div>
                    </div>
                    <input type="checkbox" checked={isChecked} readOnly />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Выбранные участники */}
          {selectedMembers.length > 0 && (
            <div style={{ marginTop: '14px' }}>
              <div className="settings-subsection-title" style={{ marginBottom: '8px', color: 'rgba(255, 255, 255, 0.7)', fontSize: '13px' }}>
                Выбрано ({selectedMembers.length})
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                {selectedMembers.map((m) => (
                  <div
                    key={m.id}
                    onClick={() => toggleMember(m)}
                    className="selected-tag"
                  >
                    <span>{m.firstName || m.username}</span>
                    <span style={{ opacity: 0.6 }}>✕</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Кнопка действия */}
        <div className="create-group-footer">
          <button
            className="glass-primary-btn"
            disabled={isCreating || !title.trim() || selectedMembers.length === 0}
            onClick={handleCreateGroup}
          >
            {isCreating ? t('creating', 'Создание...') : t('createGroupAction', 'Создать группу')}
          </button>
        </div>
      </div>
    </div>
  );
}