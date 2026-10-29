package auth

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

type authJSONEndpoint struct {
	name   string
	method string
	body   string
	limit  int
	serve  http.HandlerFunc
}

func authJSONEndpoints(h *Handler) []authJSONEndpoint {
	return []authJSONEndpoint{
		{"register", http.MethodPost, `{"username":"json_user","password":"Password1!","firstName":"Name"}`, 64 << 10, h.Register},
		{"login", http.MethodPost, `{"username":"json_owner","password":"Password1!"}`, 64 << 10, h.Login},
		{"public-key", http.MethodPost, `{"publicKey":"` + qrPublicKey + `"}`, 64 << 10, h.PublicKey},
		{"change-password", http.MethodPost, `{"currentPassword":"Password1!","newPassword":"Password2!"}`, 64 << 10, h.ChangePassword},
		{"2fa-enable", http.MethodPost, `{"password":"Password2!"}`, 64 << 10, h.TwoFAEnable},
		{"2fa-disable", http.MethodPost, `{"password":"Password2!"}`, 64 << 10, h.TwoFADisable},
		{"2fa-verify", http.MethodPost, `{"password":"Password2!"}`, 64 << 10, h.TwoFAVerify},
		{"qr-token", http.MethodPost, `{"publicKey":"` + qrPublicKey + `"}`, maxQRRequestBodyBytes, h.QRToken},
		{"qr-cancel", http.MethodDelete, `{"secret":"secret"}`, maxQRRequestBodyBytes, h.QRCancel},
		{"qr-confirm", http.MethodPost, `{"qrToken":"existing","payload":` + qrPayload + `}`, maxQRRequestBodyBytes, h.QRConfirm},
		{"offer-create", http.MethodPost, `{}`, maxQRRequestBodyBytes, h.QROfferCreate},
		{"offer-claim", http.MethodPost, claimBody(qrPublicKey), maxQRRequestBodyBytes, h.QROfferClaim},
		{"offer-confirm", http.MethodPost, `{"payload":` + qrPayload + `}`, maxQRRequestBodyBytes, h.QROfferConfirm},
	}
}

func invalidAuthBodies(body string, limit int) map[string]string {
	return map[string]string{
		"second-object": body + `{}`, "scalar": body + ` true`, "null": body + `null`,
		"garbage": body + ` garbage`, "incomplete-tail": body + ` {`,
		"empty": "", "malformed": `{"password":`,
		"oversized-first":      `{"padding":"` + strings.Repeat("x", limit) + `"}`,
		"oversized-whitespace": body + strings.Repeat(" ", limit),
	}
}

func TestAuthJSONEndpointsRejectInvalidBodyBeforeEffects(t *testing.T) {
	h := NewHandler(nil)
	for _, endpoint := range authJSONEndpoints(h) {
		for name, body := range invalidAuthBodies(endpoint.body, endpoint.limit) {
			t.Run(endpoint.name+"/"+name, func(t *testing.T) {
				code := &QRTokenData{Secret: "secret", ScannedBy: "owner", ExpiresAt: time.Now().Add(time.Hour)}
				offer := &QROfferData{OwnerID: "owner", ExpiresAt: time.Now().Add(time.Hour)}
				h.qrTokens.Store("existing", code)
				h.qrOffers.Store("existing", offer)
				beforeCode, beforeOffer := *code, *offer
				response := qrServe(endpoint.serve, qrRequest{method: endpoint.method, target: "/", pathToken: "existing", body: body, userID: "owner"})
				require.Equal(t, http.StatusBadRequest, response.Code, response.Body.String())
				require.JSONEq(t, `{"code":"invalid_json","message":"invalid JSON body"}`, response.Body.String())
				require.Empty(t, response.Result().Cookies())
				require.Equal(t, beforeCode, *code)
				require.Equal(t, beforeOffer, *offer)
				for _, store := range []interface{ Range(func(any, any) bool) }{&h.qrTokens, &h.qrOffers} {
					count := 0
					store.Range(func(key, value any) bool { count++; require.Equal(t, "existing", key); return true })
					require.Equal(t, 1, count)
				}
			})
		}
	}
}

func TestDecodeAuthJSONAcceptsWhitespaceAndEnforcesExactLimit(t *testing.T) {
	for _, limit := range []int{16 << 10, 64 << 10} {
		for _, size := range []int{limit - 1, limit, limit + 1} {
			body := `{}` + strings.Repeat(" ", size-2)
			response := httptest.NewRecorder()
			var input struct{}
			ok := decodeAuthJSON(response, httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body)), &input, int64(limit))
			require.Equal(t, size <= limit, ok)
		}
	}
	response := httptest.NewRecorder()
	var input struct {
		Value string `json:"value"`
	}
	require.True(t, decodeAuthJSON(response, httptest.NewRequest(http.MethodPost, "/", strings.NewReader("{\"value\":\"ok\"} \r\n\t")), &input, 64<<10))
	require.Equal(t, "ok", input.Value)
}
