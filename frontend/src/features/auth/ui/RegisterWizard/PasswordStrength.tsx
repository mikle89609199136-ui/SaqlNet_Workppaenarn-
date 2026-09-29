import { PASSWORD_RULES } from '@/shared/lib';

interface Props {
  score: number;
}

/**
 * Полоска силы пароля — доля выполненных требований, тех же самых, что
 * перечислены под полем. Считать её своим набором признаков нельзя:
 * полоска доходила бы до конца у пароля, который форма не принимает.
 */
export function PasswordStrength({ score }: Props) {
  const total = PASSWORD_RULES.length;
  const colors = [
    'var(--color-danger)',
    'color-mix(in srgb, var(--color-danger) 50%, var(--color-warn))',
    'var(--color-warn)',
    'var(--color-ok)',
  ];

  return (
    <div className="mt-2 h-1 overflow-hidden rounded-pill bg-divider" aria-hidden>
      <div
        className="h-full transition-all duration-[var(--transition-duration-panel)]"
        style={{
          background: score > 0 ? colors[Math.min(score, colors.length) - 1] : 'transparent',
          width: `${(score / total) * 100}%`,
        }}
      />
    </div>
  );
}
