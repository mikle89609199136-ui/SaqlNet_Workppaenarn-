package chat

import "testing"

func TestJSONMapScan(t *testing.T) {
	var permissions jsonMap
	if err := permissions.Scan([]byte(`{"can_invite_users":true}`)); err != nil {
		t.Fatalf("scan permissions: %v", err)
	}
	if permissions["can_invite_users"] != true {
		t.Fatalf("unexpected permissions: %#v", permissions)
	}
}
