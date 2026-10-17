-- Generated from internal/platform/settingsdefaults/defaults.json (#451).
-- Future changes require a NEW migration; do not regenerate applied files.
ALTER TABLE users.settings ALTER COLUMN advanced_settings SET DEFAULT '{"analytics":false,"autoReconnect":true,"autoplayGifs":true,"connectionType":"auto","dataCompression":true,"debugLog":false,"developerMode":false,"fastConnection":true,"hardwareAcceleration":true,"saveDrafts":true}'::jsonb;
ALTER TABLE users.settings ALTER COLUMN folders SET DEFAULT '[]'::jsonb;
ALTER TABLE users.settings ALTER COLUMN notification_settings SET DEFAULT '{"calls":true,"channels":true,"groups":true,"inAppNotifications":true,"messagePreview":true,"newContacts":true,"privateChats":true,"reactions":true,"readReceipts":false,"videoCalls":true}'::jsonb;
ALTER TABLE users.settings ALTER COLUMN passcode_enabled SET DEFAULT false;
ALTER TABLE users.settings ALTER COLUMN passcode_timeout SET DEFAULT 60;
ALTER TABLE users.settings ALTER COLUMN privacy_settings SET DEFAULT '{"autoDeleteAccount":true,"calls":"all","forwards":"all","groupsAdd":"all","lastSeen":"all","messagesFromStrangers":true,"phoneVisibility":"nobody","photoVisibility":"all","twoFactorAuth":false}'::jsonb;
ALTER TABLE users.settings ALTER COLUMN settings SET DEFAULT '{"accentPreset":"violet","avatarShape":"letter","callSounds":true,"chatDensity":"normal","groupConsecutiveMessages":true,"language":"ru","notifications":true,"palette":"graphite","showMessageAvatars":true,"showMessageStatus":true,"showMessageTime":true,"sounds":true,"textSize":"medium","theme":"dark"}'::jsonb;
ALTER TABLE users.settings ALTER COLUMN sound_settings SET DEFAULT '{"callsSound":true,"mediaVolume":100,"messageSound":"default","messagesSound":true,"notificationSound":"default","notificationsSound":true,"notificationsVolume":80,"ringtone":"default","sendSound":true,"vibrateOnCall":true}'::jsonb;
ALTER TABLE users.settings ALTER COLUMN storage_settings SET DEFAULT '{"autoDownloadMobile":true,"autoDownloadRoaming":false,"autoDownloadWifi":true,"deleteMediaAfter":"never"}'::jsonb;
