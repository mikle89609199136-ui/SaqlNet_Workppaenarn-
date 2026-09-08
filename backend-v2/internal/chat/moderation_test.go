package chat_test

import (
	"craneapp/backend-v2/internal/chat"
	"testing"

	"github.com/stretchr/testify/require"
)

// TestAssertCanModerate проверяет иерархию прав модерации:
// owner модерирует admin/member, admin — только member, member — никого
func TestAssertCanModerate(t *testing.T) {
	tests := []struct {
		name       string
		actorRole  string
		targetRole string
		wantErr    error
	}{
		{name: "owner - member", actorRole: "owner", targetRole: "member", wantErr: nil},
		{name: "owner - admin", actorRole: "owner", targetRole: "admin", wantErr: nil},
		{name: "owner - owner", actorRole: "owner", targetRole: "owner", wantErr: chat.ErrCannotModerateTarget},
		{name: "admin - member", actorRole: "admin", targetRole: "member", wantErr: nil},
		{name: "admin - admin", actorRole: "admin", targetRole: "admin", wantErr: chat.ErrCannotModerateTarget},
		{name: "admin - owner", actorRole: "admin", targetRole: "owner", wantErr: chat.ErrCannotModerateTarget},
		{name: "member - member", actorRole: "member", targetRole: "member", wantErr: chat.ErrCannotModerateTarget},
		{name: "member - admin", actorRole: "member", targetRole: "admin", wantErr: chat.ErrCannotModerateTarget},
		{name: "member - owner", actorRole: "member", targetRole: "owner", wantErr: chat.ErrCannotModerateTarget},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := chat.AssertCanModerate(tt.actorRole, tt.targetRole)
			if tt.wantErr == nil {
				require.NoError(t, err)
			} else {
				require.ErrorIs(t, err, chat.ErrCannotModerateTarget)
			}
		})
	}
}
