import { describeApiError } from '@/shared/api';
import { services } from '@/services';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export const useProfileEdit = (profileUser, displayName: string) => {
  const [editableUser, setEditableUser] = useState(profileUser);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ firstName: '', bio: '' });
  const [editError, setEditError] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { t } = useTranslation();

  /* Сброс при смене пользователя — сравнением во время отрисовки, а не
     эффектом. Эффект сбрасывал бы после того, как React нарисовал кадр
     с прежним человеком: форма правки успевала мигнуть чужим именем.
     Приём из документации React, «adjusting state when a prop changes». */
  const [seenUser, setSeenUser] = useState(profileUser);

  if (profileUser !== seenUser) {
    setSeenUser(profileUser);
    setEditableUser(profileUser);
    setIsEditing(false);
    setEditError('');
  }

  const startEdit = () => {
    setEditDraft({
      firstName: editableUser?.firstName || displayName,
      bio: editableUser?.bio || '',
    });
    setEditError('');
    setIsEditing(true);
  };

  const saveProfileEdit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setEditError('');
    try {
      // Предполагается, что services импортируется глобально или передан
      const updated = await services.userService.updateMe({
        firstName: editDraft.firstName.trim(),
        bio: editDraft.bio,
      });
      setEditableUser(updated);
      setIsEditing(false);
    } catch (err) {
      setEditError(describeApiError(err, t, t('profileSaveError', 'Не удалось сохранить профиль')));
    } finally {
      setIsSaving(false);
    }
  };

  return {
    editableUser,
    isEditing,
    setIsEditing,
    editDraft,
    setEditDraft,
    editError,
    isSaving,
    startEdit,
    saveProfileEdit,
  };
};
