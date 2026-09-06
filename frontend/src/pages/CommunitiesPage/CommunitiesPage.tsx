import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';

export function CommunitiesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <header className="mb-6 flex items-center gap-3">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-sheet text-xl text-ink transition hover:bg-surface"
          onClick={() => navigate('/chats')}
          aria-label={t('common.back', 'Назад')}
        >
          ‹
        </button>
        <h1 className="text-2xl font-semibold text-ink">{t('communities.title', 'Сообщества')}</h1>
      </header>

      <section className="rounded-2xl border border-line bg-sheet p-8 text-center shadow-sm">
        <div className="mb-4 text-5xl">👥</div>
        <h2 className="mb-2 text-2xl font-semibold text-ink">{t('communities.title', 'Сообщества')}</h2>
        <p className="text-base text-muted">
          {t(
            'communities.placeholder',
            'Раздел в разработке. Скоро здесь появятся сообщества, объединения и групповые пространства.'
          )}
        </p>
      </section>
    </main>
  );
}
