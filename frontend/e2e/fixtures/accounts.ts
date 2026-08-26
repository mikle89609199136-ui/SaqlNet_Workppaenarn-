/**
 * Учётные записи для прогона.
 *
 * Двух пользователей нужно ровно потому, что проверяется шифрование: у
 * каждого свои ключи в своей IndexedDB, и сообщение, зашифрованное одним,
 * второй обязан прочитать. Один пользователь в двух вкладках такой
 * проверкой не был бы — он расшифровывал бы собственным ключом.
 */

export interface IAccount {
  /** Как называть в отчёте: имена в стенде меняются, роль — нет. */
  readonly role: 'A' | 'B';
  readonly username: string;
  readonly password: string;
}

/**
 * Пароль в репозиторий не попадает. Локально задаётся в окружении, в
 * конвейере приходит из секрета.
 */
function requirePassword(): string {
  const password = process.env.E2E_PASSWORD;

  if (!password) {
    throw new Error(
      'Не задан E2E_PASSWORD. Локально: E2E_PASSWORD=… npm run e2e. ' +
        'В конвейере — секрет репозитория.'
    );
  }

  return password;
}

export const ACCOUNT_A: IAccount = {
  role: 'A',
  username: process.env.E2E_USER_A ?? 'e2e_alice_test',
  get password() {
    return requirePassword();
  },
};

export const ACCOUNT_B: IAccount = {
  role: 'B',
  username: process.env.E2E_USER_B ?? 'e2e_boris_test',
  get password() {
    return requirePassword();
  },
};

/**
 * Метка прогона.
 *
 * Тесты пишут в общий стенд, где уже лежат сообщения прошлых запусков и
 * живых людей. Искать «последнее сообщение» здесь нельзя: между отправкой
 * и проверкой мог написать кто угодно. Поэтому каждое сообщение несёт
 * метку, уникальную для запуска, и тест ищет в DOM именно её.
 */
export function uniqueMarker(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}
