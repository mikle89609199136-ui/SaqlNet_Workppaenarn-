import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { membersQuery, type IChatDto, type IMemberDto } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';
import { ConfirmDialog, RadioGroup, Spinner } from '@/shared/ui';

interface Props {
  chat: IChatDto | null;
  /** Выходит владелец: сначала он выбирает, кому передать группу. */
  needsSuccessor: boolean;
  confirming: boolean;
  onLeave: (successorId: string | null) => void;
  onDelete: () => void;
  onCancel: () => void;
}

function memberName(member: IMemberDto): string {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.username;
}

/** Админы первыми: им группу передают чаще всего. */
function successorsOf(members: IMemberDto[], selfId: string | undefined): IMemberDto[] {
  const others = members.filter((member) => member.id !== selfId);
  return [
    ...others.filter((member) => member.role === 'admin'),
    ...others.filter((member) => member.role !== 'admin'),
  ];
}

/**
 * Подтверждение выхода из группы (#90).
 *
 * Участник и админ просто подтверждают. Владелец выйти сам не может —
 * сервер требует сначала передать права, — поэтому ему здесь же
 * предлагается выбрать преемника. Если передать некому, остаётся только
 * удалить группу.
 */
export function LeaveGroupDialog({
  chat,
  needsSuccessor,
  confirming,
  onLeave,
  onDelete,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const selfId = useProfileStore((state) => state.user?.id);
  const members = useQuery({
    ...membersQuery(chat?.id ?? ''),
    enabled: Boolean(chat) && needsSuccessor,
  });
  const [picked, setPicked] = useState<string | null>(null);

  const title = chat?.title ?? '';
  const successors = successorsOf(members.data ?? [], selfId);
  // Пока человек ничего не выбрал, отмечен первый в списке: кнопка
  // подтверждения не бывает нажатой впустую.
  const successorId =
    picked && successors.some((member) => member.id === picked)
      ? picked
      : (successors[0]?.id ?? null);

  const cancel = () => {
    setPicked(null);
    onCancel();
  };

  if (!needsSuccessor) {
    return (
      <ConfirmDialog
        cancelLabel={t('cancel', 'Отмена')}
        confirmLabel={t('leaveGroup', 'Покинуть')}
        confirming={confirming}
        danger
        onCancel={cancel}
        onConfirm={() => onLeave(null)}
        open={chat !== null}
        title={t('leaveGroupTitle', { title, defaultValue: 'Покинуть «{{title}}»?' })}
      >
        {t(
          'leaveGroupText',
          'Группа пропадёт из списка чатов, новые сообщения приходить перестанут. Вернуться можно, только если вас снова добавят.'
        )}
      </ConfirmDialog>
    );
  }

  if (members.isSuccess && successors.length === 0) {
    return (
      <ConfirmDialog
        cancelLabel={t('cancel', 'Отмена')}
        confirmLabel={t('deleteGroup', 'Удалить группу')}
        confirming={confirming}
        danger
        onCancel={cancel}
        onConfirm={onDelete}
        open={chat !== null}
        title={t('deleteGroupTitle', { title, defaultValue: 'Удалить «{{title}}»?' })}
      >
        {t(
          'leaveGroupAloneText',
          'В группе нет других участников — передать её некому. Её можно только удалить вместе с перепиской.'
        )}
      </ConfirmDialog>
    );
  }

  return (
    <ConfirmDialog
      cancelLabel={t('cancel', 'Отмена')}
      confirmLabel={t('transferAndLeave', 'Передать и выйти')}
      confirming={confirming || members.isPending}
      danger
      onCancel={cancel}
      onConfirm={() => {
        if (successorId) onLeave(successorId);
      }}
      open={chat !== null}
      title={t('leaveGroupTitle', { title, defaultValue: 'Покинуть «{{title}}»?' })}
    >
      <p className="mb-3">
        {t(
          'leaveGroupOwnerText',
          'Вы владелец группы. Выберите, кому её передать: новый владелец получит все права, а вы выйдете.'
        )}
      </p>
      {members.isPending ? (
        <Spinner />
      ) : members.isError ? (
        <p className="text-danger">
          {t(
            'membersLoadFailed',
            'Не удалось загрузить участников. Закройте окно и попробуйте ещё раз.'
          )}
        </p>
      ) : (
        <RadioGroup
          label={t('newOwner', 'Новый владелец')}
          name="group-successor"
          onChange={setPicked}
          options={successors.map((member) => ({
            value: member.id,
            label:
              member.role === 'admin'
                ? `${memberName(member)} · ${t('roleAdmin', 'админ')}`
                : memberName(member),
          }))}
          value={successorId}
        />
      )}
    </ConfirmDialog>
  );
}
