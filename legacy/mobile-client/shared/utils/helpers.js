export function debounce(callback, delay) {
  let timeoutId;

  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => callback(...args), delay);
  };
}

export function generateId(prefix = 'id') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function groupBy(items, getKey) {
  return items.reduce((groups, item) => {
    const key = typeof getKey === 'function' ? getKey(item) : item[getKey];
    groups[key] ??= [];
    groups[key].push(item);
    return groups;
  }, {});
}
