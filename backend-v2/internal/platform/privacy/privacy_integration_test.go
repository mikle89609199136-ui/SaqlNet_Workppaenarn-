//go:build integration

package privacy_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"

	"craneapp/backend-v2/internal/chat"
	"craneapp/backend-v2/internal/platform/db/dbtest"
	"craneapp/backend-v2/internal/platform/privacy"
	"craneapp/backend-v2/internal/user"
)

const (
	owner  = "11111111-1111-4111-8111-111111111111"
	viewer = "22222222-2222-4222-8222-222222222222"
	other  = "44444444-4444-4444-8444-444444444444"
)

func startDatabase(t *testing.T) *sql.DB {
	t.Helper()
	db := dbtest.Postgres(t)
	dbtest.User(t, db, owner, "owner_user")
	dbtest.User(t, db, viewer, "viewer_user")
	return db
}

func setPrivacy(t *testing.T, db *sql.DB, userID, raw string) {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO users.settings (user_id, privacy_settings) VALUES ($1, $2::jsonb)
		ON CONFLICT (user_id) DO UPDATE SET privacy_settings = EXCLUDED.privacy_settings`, userID, raw)
	require.NoError(t, err)
}

func block(t *testing.T, db *sql.DB, ownerID, viewerID string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO users.blocked_users (user_id, blocked_user_id) VALUES ($1, $2)`, ownerID, viewerID)
	require.NoError(t, err)
}

func allowed(t *testing.T, db *sql.DB, ownerID, viewerID string, rule privacy.Rule) bool {
	t.Helper()
	ok, err := privacy.Allowed(context.Background(), db, ownerID, viewerID, rule)
	require.NoError(t, err)
	return ok
}

func TestAllowedOnRealSchema(t *testing.T) {
	db := startDatabase(t)

	// Настроек ещё нет — действуют значения по умолчанию.
	require.True(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	require.False(t, allowed(t, db, owner, viewer, privacy.Phone))

	setPrivacy(t, db, owner, `{"lastSeen":"nobody","photoVisibility":"contacts"}`)
	require.False(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	require.False(t, allowed(t, db, owner, viewer, privacy.Photo), "contacts — как nobody")
	require.True(t, allowed(t, db, owner, owner, privacy.LastSeen), "себе — всегда")

	setPrivacy(t, db, owner, `{"lastSeen":"all"}`)
	require.True(t, allowed(t, db, owner, viewer, privacy.LastSeen))
	block(t, db, owner, viewer)
	require.False(t, allowed(t, db, owner, viewer, privacy.LastSeen), "блокировка сильнее правила")

	require.False(t, allowed(t, db, "33333333-3333-4333-8333-333333333333", viewer, privacy.LastSeen), "владельца нет")
}

// Исключения через настоящий сервис user и настоящую схему (#784).
func TestExceptionsOnRealSchema(t *testing.T) {
	db := startDatabase(t)
	dbtest.User(t, db, other, "other_user")
	ctx := context.Background()
	users := user.NewService(db)

	status := func() map[string]any {
		t.Helper()
		got, err := users.Status(ctx, viewer, owner)
		require.NoError(t, err)
		return got
	}

	t.Run("«всегда разрешать» открывает закрытое правило только этому человеку", func(t *testing.T) {
		setPrivacy(t, db, owner, `{"lastSeen":"nobody","photoVisibility":"nobody"}`)
		saved, err := users.SetPrivacyException(ctx, owner, privacy.LastSeen, viewer, true)
		require.NoError(t, err)
		require.Equal(t, viewer, saved.ID)
		require.Equal(t, "viewer_user", saved.Username)
		require.Equal(t, privacy.AlwaysAllow, saved.Mode)
		require.NotEmpty(t, saved.CreatedAt)

		require.True(t, allowed(t, db, owner, viewer, privacy.LastSeen))
		require.NotContains(t, status(), "lastSeenApprox", "статус тоже учитывает исключение")
		require.False(t, allowed(t, db, owner, other, privacy.LastSeen), "остальным по-прежнему закрыто")
		require.False(t, allowed(t, db, owner, viewer, privacy.Photo), "исключение действует только на своё правило")
	})

	t.Run("переход в «никогда» заменяет запись, а не добавляет вторую", func(t *testing.T) {
		setPrivacy(t, db, owner, `{"lastSeen":"all"}`)
		_, err := users.SetPrivacyException(ctx, owner, privacy.LastSeen, viewer, false)
		require.NoError(t, err)

		require.False(t, allowed(t, db, owner, viewer, privacy.LastSeen))
		// Владелец ни разу не подключался — «давно».
		require.Equal(t, privacy.LongAgo, status()["lastSeenApprox"])
		require.True(t, allowed(t, db, owner, other, privacy.LastSeen))

		list, err := users.PrivacyExceptions(ctx, owner, privacy.LastSeen)
		require.NoError(t, err)
		require.Len(t, list, 1)
		require.Equal(t, privacy.NeverAllow, list[0].Mode)
	})

	t.Run("чёрный список сильнее «всегда разрешать»", func(t *testing.T) {
		_, err := users.SetPrivacyException(ctx, owner, privacy.LastSeen, other, true)
		require.NoError(t, err)
		setPrivacy(t, db, owner, `{"lastSeen":"nobody"}`)
		require.True(t, allowed(t, db, owner, other, privacy.LastSeen))

		block(t, db, owner, other)
		require.False(t, allowed(t, db, owner, other, privacy.LastSeen))
		_, err = db.Exec(`DELETE FROM users.blocked_users WHERE user_id = $1 AND blocked_user_id = $2`, owner, other)
		require.NoError(t, err)
	})

	t.Run("список по правилу и по всем правилам", func(t *testing.T) {
		_, err := users.SetPrivacyException(ctx, owner, privacy.Photo, other, false)
		require.NoError(t, err)

		lastSeen, err := users.PrivacyExceptions(ctx, owner, privacy.LastSeen)
		require.NoError(t, err)
		require.Len(t, lastSeen, 2)
		// Новые сверху.
		require.Equal(t, other, lastSeen[0].ID)

		all, err := users.PrivacyExceptions(ctx, owner, "")
		require.NoError(t, err)
		require.Len(t, all, 3)
		require.Equal(t, string(privacy.Photo), all[0].Rule)

		empty, err := users.PrivacyExceptions(ctx, viewer, "")
		require.NoError(t, err)
		require.NotNil(t, empty, "пустой список — [], а не null")
		require.Empty(t, empty)
	})

	t.Run("удаление возвращает базовое правило, повторное — не ошибка", func(t *testing.T) {
		require.NoError(t, users.RemovePrivacyException(ctx, owner, privacy.LastSeen, other))
		require.False(t, allowed(t, db, owner, other, privacy.LastSeen))
		require.NoError(t, users.RemovePrivacyException(ctx, owner, privacy.LastSeen, other))
	})

	t.Run("себя и несуществующих добавить нельзя", func(t *testing.T) {
		_, err := users.SetPrivacyException(ctx, owner, privacy.LastSeen, owner, true)
		require.ErrorIs(t, err, user.ErrSelfException)

		_, err = users.SetPrivacyException(ctx, owner, privacy.LastSeen, "33333333-3333-4333-8333-333333333333", true)
		require.ErrorIs(t, err, user.ErrNotFound)

		_, err = db.Exec(`UPDATE auth.users SET disabled_at = NOW() WHERE id = $1`, other)
		require.NoError(t, err)
		_, err = users.SetPrivacyException(ctx, owner, privacy.LastSeen, other, true)
		require.ErrorIs(t, err, user.ErrNotFound, "отключённый аккаунт — как несуществующий")

		// Схема сама не даёт записать исключение на себя.
		_, err = db.Exec(`INSERT INTO users.privacy_exceptions (owner_id, user_id, rule, allow) VALUES ($1, $1, 'lastSeen', TRUE)`, owner)
		require.Error(t, err)
	})

	t.Run("удаление пользователя удаляет его исключения", func(t *testing.T) {
		_, err := db.Exec(`DELETE FROM auth.users WHERE id = $1`, other)
		require.NoError(t, err)
		var left int
		require.NoError(t, db.QueryRow(`SELECT COUNT(*) FROM users.privacy_exceptions WHERE user_id = $1`, other).Scan(&left))
		require.Zero(t, left)
	})
}

// Настоящий SQL списка и карточки чата: собеседник, закрывший фото и
// статус, не раскрывает их ни там, ни там (#463, #783), а исключения
// меняют это для конкретного зрителя (#784).
func TestChatDataHidesWhatThePeerClosed(t *testing.T) {
	db := startDatabase(t)
	ctx := context.Background()
	_, err := db.Exec(`
		UPDATE users.profiles
		SET first_name = 'Owner', avatar_url = '/api/v2/media/avatar'
		WHERE user_id = $1
	`, owner)
	require.NoError(t, err)
	_, err = db.Exec(`INSERT INTO users.presence (user_id, online, last_seen_at) VALUES ($1, TRUE, NOW())`, owner)
	require.NoError(t, err)

	service := chat.NewService(db, nil, nil)
	users := user.NewService(db)
	chatID, _, err := service.CreatePrivate(ctx, viewer, owner)
	require.NoError(t, err)

	peer := func() chat.Chat {
		chats, err := service.List(ctx, viewer, false)
		require.NoError(t, err)
		require.Len(t, chats, 1)
		detail, err := service.Get(ctx, viewer, chatID)
		require.NoError(t, err)
		require.Equal(t, chats[0].PeerIsOnline, detail.PeerIsOnline, "список и карточка должны совпадать")
		require.Equal(t, chats[0].AvatarURL, detail.AvatarURL, "список и карточка должны совпадать")
		return detail
	}

	open := peer()
	require.True(t, open.PeerIsOnline)
	require.NotEmpty(t, open.PeerLastSeen)
	require.Equal(t, "/api/v2/media/avatar", open.AvatarURL)

	setPrivacy(t, db, owner, `{"lastSeen":"nobody","photoVisibility":"nobody"}`)
	closed := peer()
	require.False(t, closed.PeerIsOnline)
	require.Empty(t, closed.PeerLastSeen)
	require.Empty(t, closed.AvatarURL)

	// Статус закрыт для всех, но зрителю открыт исключением.
	_, err = users.SetPrivacyException(ctx, owner, privacy.LastSeen, viewer, true)
	require.NoError(t, err)
	excepted := peer()
	require.True(t, excepted.PeerIsOnline)
	require.NotEmpty(t, excepted.PeerLastSeen)
	require.Empty(t, excepted.AvatarURL, "фото закрыто: исключение было только на статус")

	// Фото открыто для всех, но от зрителя закрыто.
	setPrivacy(t, db, owner, `{"lastSeen":"all","photoVisibility":"all"}`)
	_, err = users.SetPrivacyException(ctx, owner, privacy.Photo, viewer, false)
	require.NoError(t, err)
	require.Empty(t, peer().AvatarURL)
	require.NoError(t, users.RemovePrivacyException(ctx, owner, privacy.Photo, viewer))
	require.Equal(t, "/api/v2/media/avatar", peer().AvatarURL)

	block(t, db, owner, viewer)
	blocked := peer()
	require.False(t, blocked.PeerIsOnline, "блокировка сильнее «всегда разрешать»")
	require.Empty(t, blocked.AvatarURL)
}

// «Был(а)» на настоящей схеме (#791): приблизительное время вместо скрытого
// и взаимность — в статусе и в карточке чата одинаково.
func TestLastSeenOnRealSchema(t *testing.T) {
	db := startDatabase(t)
	ctx := context.Background()
	users := user.NewService(db)
	chats := chat.NewService(db, nil, nil)
	_, err := db.Exec(`INSERT INTO users.presence (user_id, online, last_seen_at) VALUES ($1, FALSE, NOW() - INTERVAL '10 days')`, owner)
	require.NoError(t, err)
	chatID, _, err := chats.CreatePrivate(ctx, viewer, owner)
	require.NoError(t, err)

	// Что видит зритель: из статуса и из карточки чата — должно совпадать.
	seen := func() (exact bool, approx string) {
		t.Helper()
		status, err := users.Status(ctx, viewer, owner)
		require.NoError(t, err)
		detail, err := chats.Get(ctx, viewer, chatID)
		require.NoError(t, err)
		statusApprox, _ := status["lastSeenApprox"].(string)
		require.Equal(t, statusApprox, detail.PeerLastSeenApprox, "статус и карточка чата расходятся")
		require.Equal(t, status["lastSeen"], detail.PeerLastSeen, "статус и карточка чата расходятся")
		return statusApprox == "", statusApprox
	}

	exact, _ := seen()
	require.True(t, exact, "по умолчанию время открыто")

	setPrivacy(t, db, owner, `{"lastSeen":"nobody"}`)
	_, approx := seen()
	require.Equal(t, privacy.WithinMonth, approx, "10 дней назад — «в этом месяце»")

	setPrivacy(t, db, owner, `{"lastSeen":"all"}`)
	setPrivacy(t, db, viewer, `{"lastSeen":"nobody"}`)
	_, approx = seen()
	require.Equal(t, privacy.WithinMonth, approx, "зритель скрыл своё — видит только приблизительное")

	_, err = users.SetPrivacyException(ctx, viewer, privacy.LastSeen, owner, true)
	require.NoError(t, err)
	exact, _ = seen()
	require.True(t, exact, "зритель открыл своё владельцу — обмен восстановлен")

	own, err := users.Status(ctx, viewer, viewer)
	require.NoError(t, err)
	require.NotContains(t, own, "lastSeenApprox", "себе — всегда точно")

	block(t, db, owner, viewer)
	_, approx = seen()
	require.Equal(t, privacy.LongAgo, approx, "заблокированный видит «давно»")
}

// recorder записывает рассылки чата.
type recorder struct{ payloads []string }

func (r *recorder) CallRooms() *chat.CallRoomManager  { return nil }
func (r *recorder) IsUserConnected(string) bool       { return false }
func (r *recorder) BroadcastToUsers([]string, []byte) {}
func (r *recorder) BroadcastToChat(_ string, payload []byte, _ string) {
	r.payloads = append(r.payloads, string(payload))
}

// Правило «Фото» за пределами личного чата (#789) и в профиле (#440): одно
// и то же решение во всех ответах, аватара нет ни в одной рассылке.
func TestPhotoHiddenEverywhere(t *testing.T) {
	db := startDatabase(t)
	dbtest.User(t, db, other, "other_user")
	ctx := context.Background()
	const avatar = "/api/v2/media/owner-avatar"
	_, err := db.Exec(`
    INSERT INTO users.profiles (user_id, first_name, avatar_url)
    VALUES ($1, 'Owner', $2), ($3, 'Other', '/api/v2/media/other')
    ON CONFLICT (user_id) DO UPDATE
    SET first_name = EXCLUDED.first_name,
        avatar_url = EXCLUDED.avatar_url
`, owner, avatar, other)
	require.NoError(t, err)

	users := user.NewService(db)
	events := &recorder{}
	chats := chat.NewService(db, events, nil)
	groupID, err := chats.CreateGroup(ctx, owner, "group", "", "", []string{viewer})
	require.NoError(t, err)
	sent := sendOne(t, chats, owner, groupID, "фото-проверка")
	require.Equal(t, avatar, sent.SenderAvatar, "себе — свой аватар")
	require.NoError(t, chats.PinMessage(ctx, owner, groupID, sent.ID))

	// Что зритель видит об аватаре владельца в каждом ответе.
	seen := func() map[string]string {
		t.Helper()
		out := map[string]string{}
		members, err := chats.Members(ctx, viewer, groupID)
		require.NoError(t, err)
		for _, m := range members {
			if m.ID == owner {
				out["участники"] = m.AvatarURL
			}
		}
		history, err := chats.ListMessages(ctx, viewer, groupID, 50, 0)
		require.NoError(t, err)
		for _, m := range history {
			if m.ID == sent.ID {
				out["история"] = m.SenderAvatar
			}
		}
		found, err := chats.SearchMessages(ctx, viewer, "фото-проверка", 10)
		require.NoError(t, err)
		require.Len(t, found, 1)
		out["поиск сообщений"] = found[0].SenderAvatar
		pins, err := chats.ListPins(ctx, viewer, groupID)
		require.NoError(t, err)
		require.Len(t, pins, 1)
		out["закреплённые"] = pins[0].Message.SenderAvatar
		people, err := users.Search(ctx, viewer, "owner_user")
		require.NoError(t, err)
		require.Len(t, people, 1)
		out["поиск людей"] = people[0].AvatarURL
		profile, err := users.ProfileByID(ctx, viewer, owner)
		require.NoError(t, err)
		out["профиль"] = profile.AvatarURL
		return out
	}
	everywhere := func(value string) map[string]string {
		return map[string]string{
			"участники": value, "история": value, "поиск сообщений": value,
			"закреплённые": value, "поиск людей": value, "профиль": value,
		}
	}

	require.Equal(t, everywhere(avatar), seen(), "по умолчанию фото открыто")

	setPrivacy(t, db, owner, `{"photoVisibility":"nobody"}`)
	require.Equal(t, everywhere(""), seen(), "фото закрыто от всех")

	own, err := chats.Members(ctx, owner, groupID)
	require.NoError(t, err)
	for _, m := range own {
		if m.ID == owner {
			require.Equal(t, avatar, m.AvatarURL, "себе — всегда")
		}
	}

	_, err = users.SetPrivacyException(ctx, owner, privacy.Photo, viewer, true)
	require.NoError(t, err)
	require.Equal(t, everywhere(avatar), seen(), "зрителю открыто исключением")

	block(t, db, owner, viewer)
	require.Equal(t, everywhere(""), seen(), "блокировка сильнее исключения")

	// Списки самого зрителя: чёрный список и исключения тоже не раскрывают
	// фото, закрытое от него.
	block(t, db, viewer, owner)
	blocked, err := users.Blocked(ctx, viewer)
	require.NoError(t, err)
	require.Len(t, blocked, 1)
	require.Empty(t, blocked[0].AvatarURL, "чёрный список")
	exception, err := users.SetPrivacyException(ctx, viewer, privacy.LastSeen, owner, false)
	require.NoError(t, err)
	require.Empty(t, exception.AvatarURL, "ответ на добавление исключения")
	listed, err := users.PrivacyExceptions(ctx, viewer, "")
	require.NoError(t, err)
	require.Len(t, listed, 1)
	require.Empty(t, listed[0].AvatarURL, "список исключений")

	// Рассылки уходят всем участникам сразу — аватара в них нет никогда,
	// даже когда фото открыто.
	_, err = chats.AddMember(ctx, owner, groupID, other)
	require.NoError(t, err)
	require.NotEmpty(t, events.payloads)
	for _, payload := range events.payloads {
		require.NotContains(t, payload, "owner-avatar", payload)
		require.NotContains(t, payload, "/api/v2/media/other", payload)
	}
}

// sendOne — отправка пачкой из одного (#808).
func sendOne(t *testing.T, chats *chat.Service, from, chatID, content string) chat.Message {
	t.Helper()
	sent, err := chats.SendMessages(context.Background(), from, chatID, []chat.OutgoingMessage{{Content: content, Type: "text"}})
	require.NoError(t, err)
	return sent[0]
}

// forwardAs пересылает так, как это делает клиент (#808): содержимое уже
// перешифровано ключом целевого чата, а автора по forwardedFrom находит
// сервер — тем же путём, что обработчик отправки.
func forwardAs(t *testing.T, chats *chat.Service, from, messageID, toChat string) chat.Message {
	t.Helper()
	ctx := context.Background()
	source, err := chats.ForwardOrigin(ctx, from, messageID)
	require.NoError(t, err)
	metadata := map[string]any{}
	source.Apply(metadata)
	sent, err := chats.SendMessages(ctx, from, toChat, []chat.OutgoingMessage{{Content: "переслано", Type: "text", Metadata: metadata}})
	require.NoError(t, err)
	return sent[0]
}

// Правило «Пересылка» на настоящей схеме (#785): решение фиксируется в
// сообщении при пересылке; при запрете в ответах и событиях нет ни
// исходного сообщения, ни автора — только имя.
func TestForwardsRuleOnRealSchema(t *testing.T) {
	db := startDatabase(t)
	dbtest.User(t, db, other, "other_user")
	ctx := context.Background()
	users := user.NewService(db)
	events := &recorder{}
	chats := chat.NewService(db, events, nil)

	sourceChat, err := chats.CreateGroup(ctx, owner, "source", "", "", []string{viewer})
	require.NoError(t, err)
	original := sendOne(t, chats, owner, sourceChat, "оригинал")
	targetChat, _, err := chats.CreatePrivate(ctx, viewer, other)
	require.NoError(t, err)

	// Пересылает viewer; читает other.
	forward := func() chat.Message {
		t.Helper()
		events.payloads = nil
		sent := forwardAs(t, chats, viewer, original.ID, targetChat)
		history, err := chats.ListMessages(ctx, other, targetChat, 50, 0)
		require.NoError(t, err)
		for _, m := range history {
			if m.ID == sent.ID {
				return m
			}
		}
		t.Fatal("пересланного нет в истории получателя")
		return chat.Message{}
	}
	requireLinked := func(m chat.Message) {
		t.Helper()
		require.True(t, m.IsForwarded)
		require.Equal(t, "Owner", m.ForwardedSenderName)
		require.Equal(t, original.ID, m.Metadata["forwardedFrom"])
		require.Equal(t, owner, m.ForwardedSenderID, "автор — чтобы открыть профиль")
	}
	requireNameOnly := func(m chat.Message) {
		t.Helper()
		require.True(t, m.IsForwarded)
		require.Equal(t, "Owner", m.ForwardedSenderName)
		encoded, err := json.Marshal(m)
		require.NoError(t, err)
		require.NotContains(t, string(encoded), original.ID, "исходное сообщение в ответе")
		require.NotContains(t, string(encoded), owner, "автор в ответе")
		for _, payload := range events.payloads {
			require.NotContains(t, payload, original.ID, "исходное сообщение в событии")
			require.NotContains(t, payload, owner, "автор в событии")
		}
	}
	_, err = db.Exec(`
    INSERT INTO users.profiles (user_id, first_name) VALUES ($1, 'Owner')
    ON CONFLICT (user_id) DO UPDATE SET first_name = EXCLUDED.first_name
`, owner)
	require.NoError(t, err)

	requireLinked(forward())

	setPrivacy(t, db, owner, `{"forwards":"nobody"}`)
	hidden := forward()
	requireNameOnly(hidden)

	// Скрытый источник остаётся скрытым, даже когда пересылает дальше
	// тот, кому автор разрешил бы.
	_, err = users.SetPrivacyException(ctx, owner, privacy.Forwards, other, true)
	require.NoError(t, err)
	backChat, err := chats.CreateGroup(ctx, other, "back", "", "", []string{viewer})
	require.NoError(t, err)
	events.payloads = nil
	chain := forwardAs(t, chats, other, hidden.ID, backChat)
	requireNameOnly(chain)
	require.NotContains(t, chain.Metadata, "forwardedFrom")

	_, err = users.SetPrivacyException(ctx, owner, privacy.Forwards, viewer, true)
	require.NoError(t, err)
	requireLinked(forward())

	block(t, db, owner, viewer)
	requireNameOnly(forward())

	// Пересылка до #785: автора в метаданных нет — находится по оригиналу.
	var legacyID string
	require.NoError(t, db.QueryRow(`
		INSERT INTO messages.messages (chat_id, sender_id, content, type, metadata)
		VALUES ($1, $2, 'старая пересылка', 'text', jsonb_build_object('forwardedFrom', $3::text, 'forwardedSenderName', 'Owner'))
		RETURNING id::text`, targetChat, viewer, original.ID).Scan(&legacyID))
	legacy, err := chats.ListMessages(ctx, other, targetChat, 100, 0)
	require.NoError(t, err)
	found := false
	for _, m := range legacy {
		if m.ID == legacyID {
			found = true
			require.True(t, m.IsForwarded)
			require.Equal(t, owner, m.ForwardedSenderID)
		}
	}
	require.True(t, found, "старой пересылки нет в истории")

	// Решение зафиксировано: снятие запрета не раскрывает уже пересланное.
	setPrivacy(t, db, owner, `{"forwards":"all"}`)
	again, err := chats.ListMessages(ctx, other, targetChat, 50, 0)
	require.NoError(t, err)
	for _, m := range again {
		if m.ID == hidden.ID {
			requireNameOnly(m)
		}
	}
}
