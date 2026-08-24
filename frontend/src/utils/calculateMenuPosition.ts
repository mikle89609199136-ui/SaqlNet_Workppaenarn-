export const calculateMenuPosition = (clientX: number, clientY: number) => {
  const menuWidth = 232;
  const menuHeight = 350;
  const gap = 12;
  const padding = 8;

  const viewportWidth = window.innerWidth || menuWidth;
  const viewportHeight = window.innerHeight || menuHeight;

  return {
    x: Math.min(
      Math.max(clientX + gap, padding),
      viewportWidth - menuWidth - padding,
    ),
    y: Math.min(
      Math.max(clientY + gap, padding),
      viewportHeight - menuHeight - padding,
    ),
  };
};
