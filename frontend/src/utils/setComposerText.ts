/**
 * Подставить текст в поле ввода сообщения.
 *
 * Поле неконтролируемое: текст живёт в нём самом, а не в состоянии React,
 * иначе каждый набранный символ перерисовывал бы композер целиком. Поэтому
 * подстановка снаружи — правка сообщения, отмена, очистка после отправки —
 * идёт напрямую в элемент.
 *
 * Значение задаётся не присваиванием, а через встроенный сеттер, и следом
 * рассылается событие ввода. Так изменение проходит тем же путём, что и
 * набор с клавиатуры: композер узнаёт о нём своим обработчиком и обновляет
 * и черновик, и вид кнопки отправки. Простое `input.value = text` React
 * не заметил бы вовсе.
 */
export function setComposerText(input: HTMLInputElement | null, text: string): void {
  if (!input) return;

  const valueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value'
  )?.set;

  if (valueSetter) {
    valueSetter.call(input, text);
  } else {
    input.value = text;
  }

  input.dispatchEvent(new Event('input', { bubbles: true }));
}
