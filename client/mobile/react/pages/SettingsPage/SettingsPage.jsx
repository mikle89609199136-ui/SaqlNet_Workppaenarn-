import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSidebar } from "./SettingsSidebar.jsx"; // проверь путь к компоненту
import { SettingsDetailPage } from "./SettingsDetailPage.jsx"; // проверь путь к компоненту
import { FixedSearchBar } from "./FixedSearchBar.jsx"; // проверь путь к компоненту
import "../../styles/SettingsPage.css"; // проверь путь к стилям

export function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("account");
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearchChange = (query) => {
    setSearchQuery(query);
  };

  return (
    <div className="settings-page-layout" style={{ display: "flex", width: "100%", height: "100%" }}>
      {/* Левая панель: Поиск + Переключатель вкладок */}
      <div className="settings-left-pane">
        <FixedSearchBar
          searchQuery={searchQuery}
          activeTab={activeTab}
          onSearchChange={handleSearchChange}
        />
        <SettingsSidebar
          activeTab={activeTab}
          onSelectTab={(tab) => {
            setActiveTab(tab);
            setSearchQuery(""); // Сбрасываем строку поиска при смене вкладки
          }}
          t={t}
        />
      </div>

      {/* Правая панель: Содержимое выбранной вкладки (включая модалку редактирования) */}
      <div className="settings-right-pane" style={{ flex: 1, overflowY: "auto" }}>
        <SettingsDetailPage
          activeTab={activeTab}
          searchQuery={searchQuery}
          t={t}
        />
      </div>
    </div>
  );
}