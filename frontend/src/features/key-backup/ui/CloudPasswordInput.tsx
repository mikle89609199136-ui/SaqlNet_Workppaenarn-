import { forwardRef, useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Input } from '@/shared/ui';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  label: string;
  error?: string;
  hint?: string;
}

/** Поле облачного пароля с кнопкой «показать». */
export const CloudPasswordInput = forwardRef<HTMLInputElement, Props>(
  function CloudPasswordInput(props, ref) {
    const { t } = useTranslation();
    const [shown, setShown] = useState(false);

    return (
      <Input
        {...props}
        addon={
          <button
            aria-label={
              shown ? t('hidePassword', 'Скрыть пароль') : t('showPassword', 'Показать пароль')
            }
            className="text-ink-2 transition-colors hover:text-ink"
            onClick={() => setShown((value) => !value)}
            type="button"
          >
            <Icon name={shown ? 'eyeOff' : 'eye'} size="md" />
          </button>
        }
        autoCapitalize="none"
        autoCorrect="off"
        ref={ref}
        spellCheck={false}
        type={shown ? 'text' : 'password'}
      />
    );
  }
);
