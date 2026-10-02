export const hasDraggedFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes('Files') ?? false;

const isFileInput = (target: EventTarget | null) =>
  target instanceof HTMLInputElement && target.type === 'file';

export function preventStrayFileDrop(): () => void {
  const block = (event: DragEvent) => {
    if (!hasDraggedFiles(event) || isFileInput(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  };

  window.addEventListener('dragover', block);
  window.addEventListener('drop', block);
  return () => {
    window.removeEventListener('dragover', block);
    window.removeEventListener('drop', block);
  };
}
