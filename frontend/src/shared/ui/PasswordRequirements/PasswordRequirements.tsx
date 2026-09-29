import { Icon } from '../Icon';
import { PASSWORD_RULES, checkPassword, cn } from '@/shared/lib';

interface Props {
  value: string;
  className?: string;
}

/**
 * Что требуется от пароля и что из этого уже сделано.
 *
 * Показывается вместо одной строки об ошибке: строка называет ближайшее
 * невыполненное требование, а человеку нужен весь список сразу — иначе
 * он правит пароль по одному замечанию за раз.
 *
 * Список виден всегда, пока поле не пустое: подсказка, а не наказание.
 * Поэтому и цвет выполненного — обычный «получилось», а невыполненного —
 * второстепенный текст, а не красный: человек ещё печатает.
 */
export function PasswordRequirements({ value, className }: Props) {
  const done = checkPassword(value);

  return (
    <ul className={cn('m-0 mt-1.5 grid list-none gap-1 p-0', className)}>
      {PASSWORD_RULES.map((rule) => (
        <li
          className="flex items-center gap-1.5 text-meta text-ink-3 data-[done=true]:text-ok"
          data-done={done[rule.id]}
          key={rule.id}
        >
          <Icon
            className="size-3.5 shrink-0 stroke-2"
            name={done[rule.id] ? 'checkCircle' : 'circleAlert'}
          />
          {rule.label}
        </li>
      ))}
    </ul>
  );
}
