import { SectionStub } from '@/shared/ui';
import { useTranslation } from 'react-i18next';

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
