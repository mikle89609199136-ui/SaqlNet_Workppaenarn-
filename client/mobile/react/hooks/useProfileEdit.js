import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export const useProfileEdit = (profileUser, displayName) => {
  const [editableUser, setEditableUser] = useState(profileUser);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({ firstName: "", bio: "" });
  const [editError, setEditError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const { t } = useTranslation();

  // Сброс состояния при смене пользователя
  useEffect(() => {
    setEditableUser(profileUser);
    setIsEditing(false);
    setEditError("");
  }, [profileUser]);

  const startEdit = () => {
    setEditDraft({
      firstName: editableUser?.firstName || displayName,
      bio: editableUser?.bio || "",
    });
    setEditError("");
    setIsEditing(true);
  };

  const saveProfileEdit = async (e) => {
    e.preventDefault();
    setIsSaving(true);
    setEditError("");
    try {
      // Предполагается, что services импортируется глобально или передан
      const updated = await services.userService.updateMe({
        firstName: editDraft.firstName.trim(),
        bio: editDraft.bio,
      });
      setEditableUser(updated);
      setIsEditing(false);
    } catch (err) {
      setEditError(
        err.message || t("profileSaveError", "Не удалось сохранить профиль"),
      );
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
