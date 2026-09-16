import { SectionStub } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

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
