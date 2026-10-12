import { useTranslation } from 'react-i18next';
import { Button, SegmentedControl } from '@/shared/ui';
import { LANGUAGES, type TLanguage } from '@/shared/i18n/languages';
import { WelcomeFeatures } from './WelcomeFeatures';

interface Props {
  language: TLanguage;
  onLanguageChange: (language: string) => void;
  onNext: () => void;
}

export function WelcomeStep({ language, onLanguageChange, onNext }: Props) {
  const { t } = useTranslation();

  return (
    <>
      <WelcomeFeatures />
      {/* Выбор языка стоит здесь, а не среди полей: он меняет язык
          самого мастера, и человеку логично сделать это до того, как он
          начнёт что-то заполнять. */}
      <SegmentedControl
        aria-label={t('settings.language.appLanguage', 'Язык приложения')}
        className="mt-6 grid w-full"
        onChange={onLanguageChange}
        options={[...LANGUAGES]}
        value={language}
      />
      <Button className="mt-3 w-full" onClick={onNext} type="button">
        {t('createAccount', 'Создать аккаунт')}
      </Button>
    </>
  );
}
