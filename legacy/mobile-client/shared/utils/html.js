export function escapeHtml(value) {
  const element = document.createElement('div');
  element.textContent = String(value ?? '');
  return element.innerHTML;
}
