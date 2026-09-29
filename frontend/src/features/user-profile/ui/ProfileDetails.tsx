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
        className="mx-4 mb-4 flex flex-col gap-3 rounded-bubble bg-sheet-2 px-3.5 py-3"
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

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button disabled={isSaving} size="sm" type="submit" variant="primary">
            {isSaving ? t('saving', 'Сохранение...') : t('save', 'Сохранить')}
          </Button>
          <Button
            disabled={isSaving}
            onClick={onCancelEdit}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t('cancel', 'Отмена')}
          </Button>
        </div>
      </form>
    );
  }

  /* «О себе» — карточка на приподнятой поверхности, как в макете (#822).
     Пустое не показывается: «Не указано» ничего о человеке не говорит. */
  if (!profileUser.bio) return null;

  return (
    <div className="mx-4 mb-4 flex flex-col gap-0.5 rounded-bubble bg-sheet-2 px-3.5 py-3">
      <span className="text-meta text-ink-3">{t('bio', 'О себе')}</span>
      <span className="text-ui leading-[1.4] whitespace-pre-wrap text-ink">{profileUser.bio}</span>
    </div>
  );
}
