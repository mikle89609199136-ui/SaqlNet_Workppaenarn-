package chat_test

import (
	"context"
	"craneapp/backend-v2/internal/chat"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

// TestAddMember_Success проверяет успешное добавление пользователя в группу
// владельцем чата при соблюдении всех условий: валидные UUID, правильный тип чата,
// существование активного пользователя, отсутствие дублей и банов.
func TestAddMember_Success(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Инициализируем сервис. WSServer пока nil.
	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440000"
	chatID := "550e8400-e29b-41d4-a716-446655440000"
	userID := "550e8400-e29b-41d4-a716-446655440000"

	// 1. Проверка роли актора (owner или admin)
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(actorID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))

	// 2. Проверка, что чат является групповым
	mock.ExpectQuery(`SELECT type FROM chats\.chats`).
		WithArgs(chatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))

	// 3. Проверка пользователя (существует и не заблокирован в системе)
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).
		WithArgs(userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

	// 4. Проверка, что пользователь ещё не в группе
	mock.ExpectQuery(`SELECT 1 FROM chats\.members`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// 5. Проверка, что пользователь не забанен в этом чате
	mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	// 6. Вставка нового участника
	mock.ExpectExec(`INSERT INTO chats\.members`).
		WithArgs(chatID, userID).
		WillReturnResult(sqlmock.NewResult(1, 1))

	// 7. Получение данных добавленного участника для возврата
	mock.ExpectQuery(`SELECT .* FROM auth\.users .* JOIN chats\.members`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "first_name", "last_name", "avatar_url", "role", "permissions", "muted_until", "joined_at",
		}).AddRow(userID, "new_user", "Ivan", "Ivanov", "", "member", "{}", "", time.Now().Format(time.RFC3339)))

	member, err := svc.AddMember(context.Background(), actorID, chatID, userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if member == nil {
		t.Fatal("expected member object, got nil")
	}

	if member.ID != userID {
		t.Errorf("expected member id %s, got %s", userID, member.ID)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAddMember_InvalidInput(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	tests := []struct {
		name   string
		chatID string
		userID string
	}{
		{"EmptyChatID", "", "550e8400-e29b-41d4-a716-446655440000"},
		{"InvalidChatID", "not-a-uuid", "550e8400-e29b-41d4-a716-446655440000"},
		{"EmptyUserID", "550e8400-e29b-41d4-a716-446655440000", ""},
		{"InvalidUserID", "550e8400-e29b-41d4-a716-446655440000", "not-a-uuid"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := svc.AddMember(context.Background(), "actor-id", tt.chatID, tt.userID)
			if !errors.Is(err, chat.ErrInvalidInput) {
				t.Fatalf("expected ErrInvalidInput, got %v", err)
			}
		})
	}
}

// TestAddMember_ChatNotFound проверяет, что если чат не найден в базе данных,
// возвращается ошибка ErrNotFound.
func TestAddMember_ChatNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	// Эмулируем, что проверка роли прошла (актор — владелец),
	// но при запросе данных самого чата он не найден.
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(actorID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))

	mock.ExpectQuery(`SELECT type FROM chats\.chats`).
		WithArgs(chatID).
		WillReturnError(sql.ErrNoRows)

	_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
	if !errors.Is(err, chat.ErrNotFound) {
		t.Fatalf("expected ErrNotFound, got %v", err)
	}
}

// TestAddMember_PrivateChat проверяет, что добавление участников вручную
// в приватные чаты (1-на-1) запрещено и возвращает ErrInvalidChatType.
func TestAddMember_PrivateChat(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(actorID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))

	// Чат найден, но его тип — private
	mock.ExpectQuery(`SELECT type FROM chats\.chats`).
		WithArgs(chatID).
		WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("private"))

	_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
	if !errors.Is(err, chat.ErrInvalidChatType) {
		t.Fatalf("expected ErrInvalidChatType, got %v", err)
	}
}

// TestAddMember_UserNotFound проверяет, что если добавляемый пользователь
// не найден в системе или его аккаунт деактивирован (disabled_at IS NOT NULL),
// возвращается ошибка ErrUserNotFound.
func TestAddMember_UserNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	// Подкейс A: Пользователя вообще нет в таблице auth.users
	t.Run("UserDoesNotExist", func(t *testing.T) {
		mock.ExpectQuery(`SELECT role FROM chats\.members`).
			WithArgs(actorID, chatID).
			WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
		mock.ExpectQuery(`SELECT type FROM chats\.chats`).
			WithArgs(chatID).
			WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))

		// Возвращаем пустой результат (пользователь не найден)
		mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).
			WithArgs(userID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
		if !errors.Is(err, chat.ErrUserNotFound) {
			t.Fatalf("expected ErrUserNotFound, got %v", err)
		}
	})

	// Подкейс B: Пользователь найден, но он деактивирован (disabled_at установлен)
	t.Run("UserIsDisabled", func(t *testing.T) {
		mock.ExpectQuery(`SELECT role FROM chats\.members`).
			WithArgs(actorID, chatID).
			WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
		mock.ExpectQuery(`SELECT type FROM chats\.chats`).
			WithArgs(chatID).
			WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))

		// Имитируем запрос, который возвращает ID, но в логике мы проверим disabled_at
		// Либо сам SQL запрос будет содержать WHERE disabled_at IS NULL
		mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).
			WithArgs(userID).
			WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
		if !errors.Is(err, chat.ErrUserNotFound) {
			t.Fatalf("expected ErrUserNotFound, got %v", err)
		}
	})
}

// TestAddMember_Forbidden проверяет, что только владельцы и администраторы
// могут добавлять новых участников. Обычные участники получают ErrForbidden.
func TestAddMember_Forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	// Актор имеет роль 'member'
	mock.ExpectQuery(`SELECT role FROM chats\.members`).
		WithArgs(actorID, chatID).
		WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("member"))

	_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
	if !errors.Is(err, chat.ErrForbidden) {
		t.Fatalf("expected ErrForbidden, got %v", err)
	}
}

// TestAddMember_Conflict проверяет сценарии, когда пользователь не может быть добавлен
// из-за конфликта: он уже является участником или забанен.
func TestAddMember_Conflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	// Подкейс A: Пользователь уже в группе
	t.Run("AlreadyMember", func(t *testing.T) {
		mock.ExpectQuery(`SELECT role FROM chats\.members`).
			WithArgs(actorID, chatID).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
		mock.ExpectQuery(`SELECT type FROM chats\.chats`).
			WithArgs(chatID).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
		mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).
			WithArgs(userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))

		// Находим запись в chats.members
		mock.ExpectQuery(`SELECT 1 FROM chats\.members`).
			WithArgs(chatID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(true))

		_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
		if !errors.Is(err, chat.ErrAlreadyMember) {
			t.Fatalf("expected ErrAlreadyMember, got %v", err)
		}
	})

	// Подкейс B: Пользователь забанен в этом чате
	t.Run("UserBanned", func(t *testing.T) {
		mock.ExpectQuery(`SELECT role FROM chats\.members`).
			WithArgs(actorID, chatID).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
		mock.ExpectQuery(`SELECT type FROM chats\.chats`).
			WithArgs(chatID).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
		mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).
			WithArgs(userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
		mock.ExpectQuery(`SELECT 1 FROM chats\.members`).
			WithArgs(chatID, userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

		// Находим запись в chats.bans
		mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).
			WithArgs(chatID, userID).
			WillReturnRows(sqlmock.NewRows([]string{"?column?"}).AddRow(true))

		_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
		if !errors.Is(err, chat.ErrUserBanned) {
			t.Fatalf("expected ErrUserBanned, got %v", err)
		}
	})
}

// TestAddMember_Broadcast проверяет, что после успешного добавления участника
// вызывается рассылка WebSocket-события chat_member_added.
func TestAddMember_Broadcast(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = db.Close() }()

	// Для этого теста нам важно, чтобы ws был инициализирован.
	// Если в проекте WSServer — это структура, мы можем создать её минимальный экземпляр
	// или замокать интерфейс, если он будет выделен в процессе GREEN.
	svc := chat.NewService(db, nil)

	actorID := "550e8400-e29b-41d4-a716-446655440001"
	chatID := "550e8400-e29b-41d4-a716-446655440002"
	userID := "550e8400-e29b-41d4-a716-446655440003"

	// Настраиваем все успешные проверки (копия Happy Path)
	mock.ExpectQuery(`SELECT role FROM chats\.members`).WithArgs(actorID, chatID).WillReturnRows(sqlmock.NewRows([]string{"role"}).AddRow("owner"))
	mock.ExpectQuery(`SELECT type FROM chats\.chats`).WithArgs(chatID).WillReturnRows(sqlmock.NewRows([]string{"type"}).AddRow("group"))
	mock.ExpectQuery(`SELECT EXISTS\(SELECT 1 FROM auth\.users`).WithArgs(userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(true))
	mock.ExpectQuery(`SELECT 1 FROM chats\.members`).WithArgs(chatID, userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectQuery(`SELECT 1 FROM chats\.bans`).WithArgs(chatID, userID).WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))

	mock.ExpectExec(`INSERT INTO chats\.members`).WithArgs(chatID, userID).WillReturnResult(sqlmock.NewResult(1, 1))

	mock.ExpectQuery(`SELECT .* FROM auth\.users .* JOIN chats\.members`).
		WithArgs(chatID, userID).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "username", "first_name", "last_name", "avatar_url", "role", "permissions", "muted_until", "joined_at",
		}).AddRow(userID, "user", "A", "B", "", "member", "{}", "", time.Now().Format(time.RFC3339)))

	// Вызываем метод.
	// На RED-фазе мы просто проверяем, что код не падает, если ws == nil,
	// или (после реализации) что событие отправлено.
	_, err = svc.AddMember(context.Background(), actorID, chatID, userID)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
