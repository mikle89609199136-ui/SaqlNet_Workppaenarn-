# Requirements Document

## Introduction

Полная реструктуризация экрана настроек CraneApp. Текущая структура избыточна: отдельные пункты «Аккаунт», «Звуки», «Расширенные настройки» и «Код-пароль» дублируют или разрозненно представляют связанные функции. Цель — сократить и реорганизовать меню настроек в 15 чётко разграниченных разделов, добавить QR-вход на странице устройств, отобразить папки с чатами как горизонтальные вкладки в главном экране чатов, а также добавить новый раздел «Энергосбережение».

## Glossary

- **Settings_Screen**: главный экран настроек (`settings.html`), точка входа во все подразделы.
- **Profile_Page**: страница профиля (`editProfile.html`), объединяющая редактирование имени, фото, bio, username и смену пароля.
- **Devices_Page**: страница управления активными сессиями (`devices.html`).
- **QR_Login**: механизм входа в аккаунт путём сканирования QR-кода с другого устройства.
- **QR_Token**: временный одноразовый токен, кодируемый в QR-код для авторизации нового устройства. Срок действия — 60 секунд.
- **Folders_Page**: страница управления папками с чатами (`folders.html`).
- **Chat_Folder**: именованная группа чатов, созданная пользователем, с иконкой и цветом.
- **Folder_Tabs**: горизонтальная полоса вкладок в верхней части `chats.html`, отображающая «Все чаты» и пользовательские папки.
- **Notifications_Page**: страница уведомлений (`notifications.html`), включающая настройки звуков (ранее `sounds.html`).
- **Privacy_Page**: страница конфиденциальности (`privacy.html`), включающая безопасность (passcode, 2FA) и E2E-шифрование.
- **Data_Page**: страница данных и памяти (`data.html`), включающая кэш, хранилище и экспорт (ранее частично в `advanced.html`).
- **Power_Saving_Page**: новая страница энергосбережения (`powerSaving.html`).
- **Appearance_Page**: страница оформления (`appearance.html`) — тема, цвет акцента, размер шрифта.
- **Language_Page**: страница выбора языка интерфейса (`language.html`).
- **Premium_Page**: страница подписки CraneApp Премиум (`premium.html`).
- **Help_Page**: страница помощи (`help.html`).
- **Features_Page**: страница возможностей приложения (`features.html`).
- **Favorites_Section**: раздел избранных сообщений (эмуляция).
- **Recent_Calls_Section**: раздел истории звонков (эмуляция).
- **API**: серверный REST API CraneApp (`/api/v1/...`).
- **LocalStorage**: хранилище браузера, используемое для кэширования настроек.

---

## Requirements

### Requirement 1: Реструктуризация главного меню настроек

**User Story:** As a CraneApp user, I want to see a clean, logically organized settings menu, so that I can quickly find any setting without confusion.

#### Acceptance Criteria

1. THE Settings_Screen SHALL display exactly the following 15 sections in the specified order: Профиль, Избранное, Недавние звонки, Устройства, Папки с чатами, Уведомления, Конфиденциальность, Данные и память, Оформление, Энергосбережение, Язык, CraneApp Премиум, Помощь, Вопросы, Возможности.
2. THE Settings_Screen SHALL NOT display separate top-level items for «Аккаунт», «Звуки», «Расширенные настройки» и «Код-пароль».
3. WHEN a user taps any section item, THE Settings_Screen SHALL navigate to the corresponding sub-page within 300ms.
4. THE Settings_Screen SHALL display the user's avatar, display name, username and bio in the profile header block at the top.
5. WHEN the user's profile data is unavailable from the API, THE Settings_Screen SHALL display cached data from LocalStorage.

---

### Requirement 2: Страница «Профиль»

**User Story:** As a CraneApp user, I want to manage all my profile information in one place, so that I don't have to navigate between multiple screens.

#### Acceptance Criteria

1. THE Profile_Page SHALL allow the user to edit display name, username, bio and profile photo.
2. THE Profile_Page SHALL include a «Сменить пароль» action that initiates the password change flow.
3. WHEN the user saves profile changes, THE Profile_Page SHALL send the updated data to the API and reflect changes in the Settings_Screen header within 1 second.
4. IF the API returns an error during profile save, THEN THE Profile_Page SHALL display a descriptive error message and retain the user's unsaved input.
5. THE Profile_Page SHALL replace the separate «Аккаунт» section that previously existed in Settings_Screen.

---

### Requirement 3: Раздел «Избранное» (эмуляция)

**User Story:** As a CraneApp user, I want to access my saved favorite messages from the settings menu, so that I can review them quickly.

#### Acceptance Criteria

1. THE Settings_Screen SHALL include a «Избранное» item that navigates to a favorites messages view.
2. WHILE no real favorites data is available, THE Favorites_Section SHALL display a placeholder state indicating the feature is coming soon.
3. THE Favorites_Section SHALL be visually consistent with the rest of the settings sub-pages.

---

### Requirement 4: Раздел «Недавние звонки» (эмуляция)

**User Story:** As a CraneApp user, I want to see my recent call history from the settings menu, so that I can review past calls.

#### Acceptance Criteria

1. THE Settings_Screen SHALL include a «Недавние звонки» item that navigates to a call history view.
2. WHILE no real call history data is available, THE Recent_Calls_Section SHALL display a placeholder state indicating the feature is coming soon.
3. THE Recent_Calls_Section SHALL be visually consistent with the rest of the settings sub-pages.

---

### Requirement 5: QR-вход на странице «Устройства»

**User Story:** As a CraneApp user, I want to log into my account on another device by scanning a QR code, so that I don't have to enter my credentials manually.

#### Acceptance Criteria

1. THE Devices_Page SHALL display a «Войти по QR» button in addition to the existing active sessions list.
2. WHEN the user taps «Войти по QR», THE Devices_Page SHALL request a QR_Token from the API and render a QR code containing that token within 2 seconds.
3. THE Devices_Page SHALL display a countdown timer showing the remaining validity of the QR_Token (60 seconds).
4. WHEN the QR_Token expires, THE Devices_Page SHALL automatically request a new QR_Token and refresh the displayed QR code without requiring user action.
5. WHEN another device scans the QR code and the API confirms successful authentication, THE Devices_Page SHALL display a success notification and add the new device to the active sessions list.
6. IF the API returns an error when generating the QR_Token, THEN THE Devices_Page SHALL display a descriptive error message and offer a retry button.
7. WHEN the QR code modal is closed by the user, THE Devices_Page SHALL cancel the pending QR_Token polling.

---

### Requirement 6: Папки с чатами — управление

**User Story:** As a CraneApp user, I want to create and manage chat folders from the settings, so that I can organize my conversations.

#### Acceptance Criteria

1. THE Folders_Page SHALL allow the user to create, edit and delete Chat_Folder entries, each with a name (max 20 characters), icon and color.
2. THE Folders_Page SHALL allow the user to assign one or more existing chats to a Chat_Folder.
3. WHEN a Chat_Folder is saved, THE Folders_Page SHALL persist the folder data to the API and to LocalStorage.
4. IF the API is unavailable during folder save, THEN THE Folders_Page SHALL save the folder data to LocalStorage and display a sync-pending indicator.
5. THE Folders_Page SHALL display the count of chats in each folder.

---

### Requirement 7: Папки с чатами — вкладки в главном экране

**User Story:** As a CraneApp user, I want to see my chat folders as tabs at the top of the chats screen, so that I can switch between folder views like in Telegram.

#### Acceptance Criteria

1. THE Folder_Tabs SHALL be displayed as a horizontally scrollable tab bar at the top of `chats.html`, below the header.
2. THE Folder_Tabs SHALL always include an «Все чаты» tab as the first tab.
3. WHEN the user has created Chat_Folder entries, THE Folder_Tabs SHALL display one tab per folder, in the order they were created.
4. WHEN the user taps a folder tab, THE Folder_Tabs SHALL filter the chat list to show only chats belonging to that Chat_Folder.
5. WHEN the user taps «Все чаты», THE Folder_Tabs SHALL display the full unfiltered chat list.
6. WHEN the user has no Chat_Folder entries, THE Folder_Tabs SHALL display only the «Все чаты» tab (no empty tab bar).
7. WHEN folders are updated in Folders_Page, THE Folder_Tabs SHALL reflect the changes the next time `chats.html` is loaded or the page regains focus.

---

### Requirement 8: Уведомления — объединение с разделом звуков

**User Story:** As a CraneApp user, I want to manage notification sounds on the same page as other notification settings, so that I don't have to navigate to a separate sounds screen.

#### Acceptance Criteria

1. THE Notifications_Page SHALL include a «Звуки» subsection containing all settings previously located in `sounds.html`.
2. THE Notifications_Page SHALL allow the user to select a notification sound from a predefined list and preview it by tapping.
3. THE Settings_Screen SHALL NOT display a separate «Звуки» top-level item.
4. WHEN the user changes a sound setting, THE Notifications_Page SHALL save the selection to LocalStorage and to the API.

---

### Requirement 9: Конфиденциальность — объединение с безопасностью и E2E

**User Story:** As a CraneApp user, I want all privacy, security and encryption settings in one place, so that I have a single screen for protecting my account.

#### Acceptance Criteria

1. THE Privacy_Page SHALL include a «Безопасность» subsection containing passcode settings (previously in `passcode.html` top-level item) and 2FA toggle.
2. THE Privacy_Page SHALL include an «E2E-шифрование» subsection with information about end-to-end encryption status and a toggle to enable it for new chats.
3. THE Privacy_Page SHALL include a «Заблокированные пользователи» subsection with the ability to view and unblock users.
4. THE Settings_Screen SHALL NOT display a separate «Код-пароль» top-level item.
5. WHEN the user enables or disables passcode from Privacy_Page, THE Privacy_Page SHALL update the passcode status indicator without requiring a page reload.

---

### Requirement 10: Данные и память — объединение с расширенными настройками

**User Story:** As a CraneApp user, I want to manage cache, storage and data export in one dedicated screen, so that I can control the app's resource usage.

#### Acceptance Criteria

1. THE Data_Page SHALL display current cache size and allow the user to clear the cache with a single tap.
2. THE Data_Page SHALL display total local storage usage.
3. THE Data_Page SHALL include a data export action that downloads the user's data as a JSON file.
4. THE Data_Page SHALL include the «Автопроигрывание GIF» and «Сохранять черновики» toggles previously located in `advanced.html`.
5. THE Settings_Screen SHALL NOT display a separate «Расширенные настройки» top-level item.
6. IF the export API returns an error, THEN THE Data_Page SHALL display a descriptive error message.

---

### Requirement 11: Новый раздел «Энергосбережение»

**User Story:** As a CraneApp user, I want a dedicated power saving mode, so that I can extend battery life on mobile devices.

#### Acceptance Criteria

1. THE Power_Saving_Page SHALL provide a master «Режим энергосбережения» toggle that enables or disables all power saving measures at once.
2. WHEN the master toggle is enabled, THE Power_Saving_Page SHALL disable CSS animations across the application by setting a `data-power-saving` attribute on `document.documentElement`.
3. WHEN the master toggle is enabled, THE Power_Saving_Page SHALL reduce the polling frequency for background data updates from the default interval to an interval no less than 60 seconds.
4. THE Power_Saving_Page SHALL provide individual toggles for «Отключить анимации» and «Снизить частоту обновлений» that can be controlled independently of the master toggle.
5. WHEN the user changes any power saving setting, THE Power_Saving_Page SHALL persist the setting to LocalStorage and apply it immediately without a page reload.
6. WHILE power saving mode is active, THE Settings_Screen SHALL display a visual indicator (e.g. a battery icon) next to the «Энергосбережение» menu item.

---

### Requirement 12: Оформление

**User Story:** As a CraneApp user, I want to customize the app's visual appearance, so that it matches my personal preferences.

#### Acceptance Criteria

1. THE Appearance_Page SHALL allow the user to switch between dark and light themes.
2. THE Appearance_Page SHALL allow the user to select an accent color from a predefined palette of at least 5 colors.
3. THE Appearance_Page SHALL allow the user to select a font size from at least 3 options: small (14px), medium (16px), large (18px).
4. WHEN the user changes any appearance setting, THE Appearance_Page SHALL apply the change immediately to all open pages via CSS custom properties.
5. WHEN the user changes any appearance setting, THE Appearance_Page SHALL persist the change to LocalStorage and to the API.

---

### Requirement 13: Язык

**User Story:** As a CraneApp user, I want to change the interface language, so that I can use the app in my preferred language.

#### Acceptance Criteria

1. THE Language_Page SHALL display a list of at least 10 supported languages with their native names and flag icons.
2. WHEN the user selects a language, THE Language_Page SHALL apply the new language to the current page immediately via the i18n module.
3. WHEN the user selects a language, THE Language_Page SHALL persist the selection to LocalStorage and to the API.
4. THE Language_Page SHALL visually indicate the currently active language with a checkmark.

---

### Requirement 14: Навигация и удалённые пункты меню

**User Story:** As a CraneApp developer, I want the settings navigation to be consistent and free of orphaned pages, so that users are never routed to deprecated screens.

#### Acceptance Criteria

1. THE Settings_Screen SHALL NOT contain navigation links to `sounds.html`, `advanced.html` as standalone top-level items.
2. THE Settings_Screen SHALL NOT contain a standalone «Код-пароль» top-level navigation item.
3. THE Settings_Screen SHALL NOT contain a standalone «Аккаунт» top-level navigation item separate from «Профиль».
4. WHEN a user navigates directly to a deprecated URL (e.g. `sounds.html`), THE application SHALL redirect the user to the appropriate merged page (e.g. `notifications.html`).

---

### Requirement 15: Сохранение и синхронизация настроек

**User Story:** As a CraneApp user, I want my settings to be saved and synchronized across devices, so that my preferences are consistent everywhere.

#### Acceptance Criteria

1. THE Settings_Screen SHALL display a sync status indicator showing «Синхронизация...», «Синхронизировано» or an error state.
2. WHEN any setting is changed, THE application SHALL first write the change to LocalStorage, then send it to the API asynchronously.
3. IF the API sync fails, THEN THE application SHALL retain the change in LocalStorage and display a non-blocking error indicator.
4. WHEN the Settings_Screen is loaded, THE application SHALL load settings from LocalStorage immediately and then refresh from the API in the background.
5. WHEN the API returns updated settings that differ from LocalStorage, THE application SHALL update LocalStorage and re-render the affected UI elements.
