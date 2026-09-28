import { useTranslation } from 'react-i18next';
import { Icon } from '@/shared/ui';
import type { TIconTypes } from '@/types';

/** Что умеет приложение — по макету (#827): монохромные значки вместо эмодзи. */
export function WelcomeFeatures() {
  const { t } = useTranslation();
  const features: { icon: TIconTypes; text: string }[] = [
    { icon: 'shield', text: t('welcomeFeatureE2E', 'Сквозное шифрование всех сообщений') },
    { icon: 'zap', text: t('welcomeFeatureDelivery', 'Мгновенная доставка в любой точке мира') },
    { icon: 'mic', text: t('welcomeFeatureMedia', 'Голосовые, видео и звонки') },
    { icon: 'lock', text: t('welcomeFeaturePrivacy', 'Полная защита данных и приватность') },
  ];

  return (
    <ul className="m-0 grid list-none gap-3 p-0 text-left">
      {features.map(({ icon, text }) => (
        <li className="flex items-center gap-3.5" key={text}>
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-icon bg-brand-soft text-brand"
          >
            <Icon className="stroke-[1.8px]" name={icon} size="md" />
          </span>
          <span className="text-ui leading-[1.45] text-ink-2">{text}</span>
        </li>
      ))}
    </ul>
  );
}
