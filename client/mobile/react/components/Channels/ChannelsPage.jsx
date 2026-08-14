import { useNavigate } from 'react-router-dom';

export function ChannelsPage({ t = (k, f) => f }) {
  const navigate = useNavigate();

  return (
    <main className="settings-page" style={{ padding: '24px 20px' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <button
          className="back-arrow-btn"
          onClick={() => navigate('/chats')}
          aria-label={t('back', 'Назад')}
          type="button"
        >
          ‹
        </button>
        <h1 style={{ margin: 0, fontSize: 24 }}>{t('channels', 'Каналы')}</h1>
      </header>

      <section
        style={{
          background: 'var(--react-panel, rgba(255,255,255,0.04))',
          border: '1px solid var(--react-border, rgba(255,255,255,0.08))',
          borderRadius: 20,
          padding: '32px 20px',
          textAlign: 'center',
          color: 'var(--react-text, #f3f6ff)',
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 12 }}>📣</div>
        <h2 style={{ margin: '0 0 8px', fontSize: 26 }}>Каналы</h2>
        <p style={{ margin: 0, color: 'var(--react-muted, #b8bfd6)', lineHeight: 1.6 }}>
          Раздел в разработке. Скоро здесь появятся каналы, подписки и публикации.
        </p>
      </section>
    </main>
  );
}
