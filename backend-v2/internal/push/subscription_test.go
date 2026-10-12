package push

import (
	"encoding/base64"
	"strings"
	"testing"
)

func validKeys() Keys {
	p256dh := make([]byte, 65)
	p256dh[0] = 0x04
	return Keys{
		P256dh: base64.RawURLEncoding.EncodeToString(p256dh),
		Auth:   base64.RawURLEncoding.EncodeToString(make([]byte, 16)),
	}
}

// Сервер сам ходит по адресу подписки — только https и только известные
// push-сервисы, иначе подписка превращается в запрос во внутреннюю сеть.
func TestSubscriptionEndpointAllowList(t *testing.T) {
	allowed := []string{
		"https://fcm.googleapis.com/fcm/send/abc",
		"https://updates.push.services.mozilla.com/wpush/v2/abc",
		"https://web.push.apple.com/QGuQ",
		"https://wns2-par02p.notify.windows.com/w/?token=abc",
	}
	for _, endpoint := range allowed {
		if err := (Subscription{Endpoint: endpoint, Keys: validKeys()}).Validate(); err != nil {
			t.Errorf("%s: want allowed, got %v", endpoint, err)
		}
	}

	rejected := []string{
		"",
		"http://fcm.googleapis.com/fcm/send/abc",            // не https
		"https://127.0.0.1/push",                            // внутренняя сеть
		"https://localhost/push",                            // внутренняя сеть
		"https://chat:8083/api/v2/messages",                 // сервис рядом
		"https://169.254.169.254/latest/meta-data",          // метаданные облака
		"https://evil.com/fcm.googleapis.com",               // имя в пути
		"https://fcm.googleapis.com.evil.com/x",             // похожий домен
		"https://notpush.apple.com/x",                       // суффикс без точки
		"https://push.apple.com/x",                          // голый домен без поддомена
		"https://user:pass@fcm.googleapis.com/fcm/send/abc", // учётные данные в адресе
		"https://fcm.googleapis.com:8443/fcm/send/abc",      // чужой порт
		"https://fcm.googleapis.com/" + strings.Repeat("a", maxEndpointLength),
	}
	for _, endpoint := range rejected {
		if err := (Subscription{Endpoint: endpoint, Keys: validKeys()}).Validate(); err == nil {
			t.Errorf("%q: want rejected", endpoint)
		}
	}
}

func TestSubscriptionKeys(t *testing.T) {
	endpoint := "https://fcm.googleapis.com/fcm/send/abc"
	good := validKeys()

	std := Keys{
		P256dh: base64.StdEncoding.EncodeToString(append([]byte{0x04}, make([]byte, 64)...)),
		Auth:   base64.StdEncoding.EncodeToString(make([]byte, 16)),
	}
	if err := (Subscription{Endpoint: endpoint, Keys: std}).Validate(); err != nil {
		t.Errorf("standard base64 with padding: %v", err)
	}

	bad := []Keys{
		{P256dh: "", Auth: good.Auth},
		{P256dh: good.P256dh, Auth: ""},
		{P256dh: "not base64!", Auth: good.Auth},
		{P256dh: base64.RawURLEncoding.EncodeToString(make([]byte, 65)), Auth: good.Auth}, // не 0x04
		{P256dh: base64.RawURLEncoding.EncodeToString(make([]byte, 33)), Auth: good.Auth},
		{P256dh: good.P256dh, Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 8))},
	}
	for i, keys := range bad {
		if err := (Subscription{Endpoint: endpoint, Keys: keys}).Validate(); err == nil {
			t.Errorf("case %d: want rejected", i)
		}
	}
}
