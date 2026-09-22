import { SectionStub } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

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
