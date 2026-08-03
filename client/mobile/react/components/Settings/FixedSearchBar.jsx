export function FixedSearchBar({ activeTab, onSearchChange }) {
  return (
    <div className="chats-toolbar">
      <div className="chats-search">
        <input 
          type="text"
          className="chats-search-input"
          placeholder={
            activeTab === 'settings' 
              ? "Поиск по настройкам..."  // Заглушка для режимов настроек
              : "Поиск чатов..."
          }
          onChange={(e) => onSearchChange(e.target.value, activeTab)}
        />
      </div>
    </div>
  );
}