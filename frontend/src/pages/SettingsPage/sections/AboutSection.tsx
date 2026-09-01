import { useToasts } from '@/hooks/useToasts';
import { services } from '@/services/serviceContainer';
import { SettingsSection } from '../SettingsControls';

export function AboutSection() {
  const { showToast } = useToasts();

  return (
    <SettingsSection description="CraneApp Messenger" title="О приложении">
      <div className="settings-about-version">Версия 2</div>
      <button className="settings-secondary-button" onClick={() => downloadExport(showToast)}>
        Экспортировать мои данные
      </button>
    </SettingsSection>
  );
}

async function downloadExport(showToast: (type: string, message: string) => void) {
  try {
    const data = await services.userService.exportData();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'craneapp-data.json';
    link.click();
    URL.revokeObjectURL(url);
  } catch (_) {
    showToast('error', 'Не удалось экспортировать данные');
  }
}
