// FixedSearchBar.jsx
export function FixedSearchBar({ searchQuery, activeTab, onSearchChange }) {
  // Определяем placeholder в зависимости от текущей страницы/вкладки
  const getPlaceholder = () => {
    if (activeTab === 'chats') return "Поиск чатов...";
    if (activeTab === 'contacts') return "Поиск контактов...";
    if (['account', 'notifications', 'appearance', 'privacy', 'language', 'about'].includes(activeTab)) {
      return "Поиск по настройкам...";
    }
    return "Поиск...";
  };

  return (
    <div className="chats-toolbar">
      <div className="chats-search">
        <input 
          type="text"
          className="chats-search-input"
          placeholder={getPlaceholder()}
          value={searchQuery || ''} 
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}