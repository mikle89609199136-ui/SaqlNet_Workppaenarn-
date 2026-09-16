import { useTranslation } from 'react-i18next';

export function WelcomeFeatures() {
  const { t } = useTranslation();
  const features = [
    { icon: '🔒', text: t('welcomeFeatureE2E', 'End-to-end шифрование всех сообщений') },
    { icon: '⚡️', text: t('welcomeFeatureDelivery', 'Мгновенная доставка в любой точке мира') },
    { icon: '🎨', text: t('welcomeFeatureMedia', 'Голосовые, видео, стикеры и многое другое') },
    { icon: '🛡️', text: t('welcomeFeaturePrivacy', 'Полная защита данных и приватность') },
  ];

  return (
    <ul className="grid gap-3 text-left">
      {features.map(({ icon, text }) => (
        <li className="flex items-center gap-3" key={text}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control bg-brand-soft">
            {icon}
          </span>
          <span className="text-caption text-ink-2">{text}</span>
        </li>
      ))}
    </ul>
  );
}
