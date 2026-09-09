import { useTranslation } from 'react-i18next';
import { SectionStub } from './SectionStub';

export function ChannelsPage() {
  const { t } = useTranslation();

  return (
    <SectionStub icon="channel" title={t('channelsStubTitle', 'Каналов пока нет')}>
      {t(
        'channelsStubText',
        'Раздел ещё делается. Пока объявления и новости удобно вести в группе — там же, где переписка.'
      )}
    </SectionStub>
  );
}

export function CommunitiesPage() {
  const { t } = useTranslation();

  return (
    <SectionStub icon="users" title={t('communitiesStubTitle', 'Сообществ пока нет')}>
      {t(
        'communitiesStubText',
        'Раздел ещё делается. Пока общий разговор можно собрать группой и добавить в неё нужных людей.'
      )}
    </SectionStub>
  );
}

export function MeetingsPage() {
  const { t } = useTranslation();

  return (
    <SectionStub icon="video" title={t('meetingsStubTitle', 'Встреч пока нет')}>
      {t(
        'meetingsStubText',
        'Раздел ещё делается. Позвонить собеседнику уже можно: кнопки звонка есть в шапке чата.'
      )}
    </SectionStub>
  );
}
