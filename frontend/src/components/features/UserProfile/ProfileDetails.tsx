import { Button, Input } from '@/shared/ui';
import type { IUserDto } from '@/types';
import type { ChangeEvent, FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  profileUser: IUserDto;
  isEditing: boolean;
  editDraft: { firstName: string; bio: string };
  editError: string;
  isSaving: boolean;
  onDraftChange: (draft: { firstName: string; bio: string }) => void;
  onSave: (e: FormEvent) => Promise<void>;
  onCancelEdit: () => void;
}

export function ProfileDetails({
  profileUser,
  isEditing,
  editDraft,
  editError,
  isSaving,
  onDraftChange,
  onSave,
  onCancelEdit,
}: Props) {
  const { t } = useTranslation();

  if (isEditing) {
    return (
      <form
        className="flex flex-col gap-3 p-3 bg-sheet-2 border border-line rounded-field"
        onSubmit={onSave}
      >
        <Input
          label={t('name', 'Имя')}
          name="firstName"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onDraftChange({ ...editDraft, firstName: e.target.value })
          }
          placeholder={t('enterName', 'Введите имя')}
          value={editDraft.firstName}
        />
        <Input
          label={t('bio', 'О себе')}
          name="bio"
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            onDraftChange({ ...editDraft, bio: e.target.value })
          }
          placeholder={t('enterBio', 'О себе')}
          value={editDraft.bio}
        />

        {editError && <p className="text-caption text-danger">{editError}</p>}

        <div className="flex items-center gap-2 mt-2">
          <Button disabled={isSaving} size="md" type="submit" variant="primary">
            {isSaving ? t('saving', 'Сохранение...') : t('save', 'Сохранить')}
          </Button>
          <Button
            disabled={isSaving}
            onClick={onCancelEdit}
            size="md"
            type="button"
            variant="secondary"
          >
            {t('cancel', 'Отмена')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col divide-y divide-divider bg-sheet-2 border border-line rounded-field overflow-hidden">
      <div className="p-3 flex flex-col gap-0.5">
        <span className="text-caption text-ink-3">{t('name', 'Имя')}</span>
        <span className="text-body text-ink font-medium">
          {profileUser.firstName || t('notSpecified', 'Не указано')}
        </span>
      </div>

      <div className="p-3 flex flex-col gap-0.5">
        <span className="text-caption text-ink-3">{t('bio', 'О себе')}</span>
        <span className="text-body text-ink font-medium whitespace-pre-wrap">
          {profileUser.bio || t('notSpecified', 'Не указано')}
        </span>
      </div>

      <div className="p-3 flex flex-col gap-0.5">
        <span className="text-caption text-ink-3">{t('username', 'Имя пользователя')}</span>
        <span className="text-body text-ink font-medium">@{profileUser.username}</span>
      </div>
    </div>
  );
}
