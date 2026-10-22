# Notification model v1: миграция и rollout

Реализация #1042, 22 октября 2026. Контракт — [notification settings](notification-settings.md). Единственный активный источник notifications/sounds/callSounds — общий settings. Notification details остаются compatibility data; aliases messagesSound/notificationsSound проецируют sounds, callsSound проецирует callSounds.

## Однократный переход

Новая migration `0042_notification_settings_model.sql` добавляет внутренний notification_model_version. Существующие строки получают 0, затем нормализуются и переводятся в 1. Default новых/восстановленных строк — сразу 1; регистрация/ensure используют прежний общий источник defaults #451. Marker не входит в JSON preferences, DTO или экспорт и не принимается API.

В одной транзакции мигратора сохраняется исходный settings/sound_settings в `users.notification_settings_backup_v1`, затем обновляются только три canonical booleans и marker:

1. Присутствующий canonical boolean приоритетен, включая false; присутствующий неверный тип/null закрывается в false.
2. При отсутствии sounds берётся AND старых messagesSound и notificationsSound; отсутствующий operand — true, присутствующий не-boolean — false.
3. При отсутствии callSounds используется старый callsSound, иначе true. От sounds он независим.
4. Отсутствующий notifications получает true. Категорийные/in-app flags не превращаются в global gate.
5. Повреждённый корень общего settings закрывает все три flags в false. Повреждённый корень legacy sound_settings закрывает legacy fallback в false, но не переопределяет валидный canonical выбор.

Theme/language/Appearance, privacy, folders, другие sections, chat preferences, subscriptions и updated_at не меняются. Legacy aliases физически сохраняются в старом sound_settings; после перехода они не участвуют в чтении preferences и не записываются новыми adapters. Backup также сохраняет повреждённые исходные JSON для проверяемого отката. Он внутренний, не логируется и удаляется при удалении settings/account через FK cascade.

Повторный запуск миграции пропускает строки версии 1 и не отменяет последующее canonical изменение старым legacy значением. GET/refetch/push не повторяют legacy fallback. Отсутствующие canonical keys на версии 1 получают общие read defaults; неверные present flags остаются false. Shared reader `internal/platform/notificationpolicy` используется API и push.

## Запись и чтение после перехода

Все входящие поля валидируются до SQL, включая проигравшие aliases. В одном bulk запросе явный canonical sounds/callSounds побеждает aliases. Без sounds два разных переданных message aliases дают 400 validation_failed без записи. Один alias меняет соответствующий canonical flag независимо от старой физической alias-копии; не выполняется повторный AND с прошлым snapshot.

Legacy sound/bulk writes применяют canonical и compatibility-only части одним UPDATE внутри общего locked mutation path #1047. Ошибка UPDATE/COMMIT откатывает всю операцию, включая создание строки. Canonical PUT сохраняет atomic SQL merge и сериализуется той же row lock. Sound GET/PUT и bulk GET проецируют aliases из canonical flags одним согласованным чтением/commit; прочие response envelopes сохраняются. Volume/мелодии/sendSound/vibrateOnCall не меняют effective policy.

## Push и обновление worker

Push Directory проверяет актуальный canonical notifications и personal message mute #559; видимость конкретной подписки по-прежнему исключает её из доставки. Payload v1 дополнен обязательным boolean silent: сообщение использует !sounds, входящий звонок !callSounds, пропущенный звонок всегда true. Global off подавляет все три вида событий, не удаляет подписки и не сбрасывает preferences. Plaintext, ключи, полные settings и credentials в payload не добавляются.

Новый worker передаёт silent в NotificationOptions и не задаёт renotify при quiet policy. Старый/неверный payload без явного silent=false показывается тихо; missed_call остаётся тихим даже при неверно переданном false. Собственного аудио/вибрации в worker нет. Browser fallback, message sound и рингтон открытого приложения остаются #725.

Rollout: сначала распространить frontend/worker с поддержкой silent; активный старый worker обновляется существующим механизмом приложения (#892). Затем остановить старые user/chat writers, применить миграции штатным `cmd/migrate` и запустить новые user/chat binaries. Нельзя оставлять writers, которые сохраняют legacy aliases в обход resolver. Старые worker игнорируют добавленное поле: формат payload совместим, но тихая sound policy гарантируется только обновлённым worker. Не нужно удалять или перевыпускать push subscriptions.

## Откат и проверка

При неуспехе migration transaction не сохраняет ни backup, ни flags, ни marker. Для немедленного отката после успешной миграции writers должны оставаться остановлены. Под блокировкой settings восстановить settings/sound_settings из backup и установить version=0. После восстановления удалить соответствующие backup rows в той же транзакции: исходные JSON уже снова находятся в settings, а повторный rollout сможет снять свежий snapshot. Старый код игнорирует дополнительную колонку/таблицу; schema drops не нужны.

Полный snapshot нельзя накатывать поверх последующих пользовательских writes: такой откат требует разбора новых изменений и существующей резервной копии БД. Автоматического rollback после работы пользователей нет.

`notification_settings_integration_test.go` проверяет canonical/legacy priority, неверные типы/корни, backup/restore, replay после нового выбора, отсутствие побочных изменений и атомарный отказ миграции. HTTP regression tests проверяют все readers/writers, conflict 400 и rollback смешанной canonical/compatibility записи. PostgreSQL lock barriers проверяют конкуренцию canonical/alias patches. Реальный push Notifier проверяет все 16 N/S/C/M сочетаний, две подписки, видимость и invalid flags. Worker tests исполняют настоящий sw.js с новым/legacy/invalid silent.
