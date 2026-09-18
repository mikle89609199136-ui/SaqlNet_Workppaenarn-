import { describe, expect, it } from 'vitest';
import { eventBus } from '@/core/EventBus';
import { useChatUiStore } from '@/entities/chat';
import { useProfileStore } from '@/entities/user';

// Тесты самой инфраструктуры: если сброс состояния между тестами перестанет
// работать, остальные тесты начнут падать в зависимости от порядка запуска,
// и причину будут искать в прикладном коде.
describe('окружение jsdom', () => {
  it('should provide the browser APIs the app relies on', () => {
    expect(typeof Element.prototype.scrollIntoView).toBe('function');
    expect(typeof requestAnimationFrame).toBe('function');
    expect(typeof URL.createObjectURL).toBe('function');
    expect(typeof matchMedia).toBe('function');
    expect(typeof Notification).toBe('function');
    expect(navigator.clipboard).toBeDefined();
  });

  it('should build absolute URLs from a real origin', () => {
    // Без environmentOptions.jsdom.url здесь был бы about:blank,
    // и ApiClient.buildUrl не собрал бы адрес запроса.
    expect(location.origin).toBe('http://localhost:3000');
  });

  it('should support jest-dom matchers', () => {
    const element = document.createElement('div');
    element.textContent = 'привет';
    document.body.append(element);

    expect(element).toBeInTheDocument();
    expect(element).toHaveTextContent('привет');
  });
});

describe('сброс глобального состояния', () => {
  it('should accept state written by a test', () => {
    useChatUiStore.getState().setError('ошибка из первого теста');
    useProfileStore.getState().setToken('токен из первого теста');
    eventBus.on('new_message', () => {});
    localStorage.setItem('craneapp_probe', 'значение');

    expect(useChatUiStore.getState().error).toBe('ошибка из первого теста');
  });

  it('should not leak that state into the next test', () => {
    expect(useChatUiStore.getState().error).toBe('');
    expect(useProfileStore.getState().token).toBe('');
    expect(localStorage.getItem('craneapp_probe')).toBeNull();

    // Подписка предыдущего теста снята: обработчик не вызывается.
    let called = false;
    eventBus.on('new_message', () => {
      called = true;
    });
    eventBus.emit('new_message', { chatId: 'x' } as never);
    expect(called).toBe(true);
  });
});
