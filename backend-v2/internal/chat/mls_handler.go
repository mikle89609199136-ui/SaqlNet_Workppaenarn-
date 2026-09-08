package chat

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"craneapp/backend-v2/internal/platform/authctx"
	"craneapp/backend-v2/internal/platform/config"
	"craneapp/backend-v2/internal/platform/httpx"
)

func (h *Handler) MLSRoutes(w http.ResponseWriter, r *http.Request) {
	current := authctx.MustUser(r)
	path := r.URL.Path
	cryptoURL := config.Value("CRYPTO_URL", "http://127.0.0.1:5005")

	switch {
	// POST /api/v2/mls/keypackages
	case path == "/api/v2/mls/keypackages" && r.Method == http.MethodPost:
		h.mlsUploadKeyPackages(w, r, current.ID, cryptoURL)

	// GET /api/v2/mls/keypackages/:userId
	case strings.HasPrefix(path, "/api/v2/mls/keypackages/") && r.Method == http.MethodGet:
		targetID := strings.TrimPrefix(path, "/api/v2/mls/keypackages/")
		h.mlsFetchKeyPackage(w, r, current.ID, targetID)

	// GET /api/v2/mls/group/:chatId/state
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/state") && r.Method == http.MethodGet:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/state")
		h.mlsGetGroupState(w, r, current.ID, chatID)

	// POST /api/v2/mls/group/:chatId/commit
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/commit") && r.Method == http.MethodPost:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/commit")
		h.mlsCommit(w, r, current.ID, chatID, cryptoURL)

	// POST /api/v2/mls/group/:chatId/welcome
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/welcome") && r.Method == http.MethodPost:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/welcome")
		h.mlsStoreWelcome(w, r, current.ID, chatID, cryptoURL)

	// GET /api/v2/mls/group/:chatId/welcome
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/welcome") && r.Method == http.MethodGet:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/welcome")
		h.mlsGetWelcome(w, r, current.ID, chatID)

	// POST /api/v2/mls/group/:chatId/proposals
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/proposals") && r.Method == http.MethodPost:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/proposals")
		h.mlsAddProposal(w, r, current.ID, chatID, cryptoURL)

	// GET /api/v2/mls/group/:chatId/proposals
	case strings.HasPrefix(path, "/api/v2/mls/group/") && strings.HasSuffix(path, "/proposals") && r.Method == http.MethodGet:
		chatID := strings.TrimSuffix(strings.TrimPrefix(path, "/api/v2/mls/group/"), "/proposals")
		h.mlsGetProposals(w, r, current.ID, chatID)

	default:
		httpx.ErrorJSON(w, r, http.StatusNotFound, "route_not_found", "route not found")
	}
}

func (h *Handler) mlsUploadKeyPackages(w http.ResponseWriter, r *http.Request, userID, cryptoURL string) {
	var input struct {
		KeyPackages []string `json:"keypackages"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if err := h.service.MLSUploadKeyPackages(r.Context(), userID, input.KeyPackages, cryptoURL); err != nil {
		if errors.Is(err, errors.New("crypto service unavailable")) {
			httpx.ErrorJSON(w, r, http.StatusServiceUnavailable, "crypto_unavailable", err.Error())
			return
		}
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_keypackage", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) mlsFetchKeyPackage(w http.ResponseWriter, r *http.Request, requesterID, targetID string) {
	kp, err := h.service.MLSFetchKeyPackage(r.Context(), requesterID, targetID)
	if err != nil {
		code := http.StatusInternalServerError
		errCode := "internal_error"
		msg := err.Error()
		if msg == "access denied" {
			code, errCode = http.StatusForbidden, "access_denied"
		} else if msg == "no keypackages available for user" {
			code, errCode = http.StatusNotFound, "not_found"
		}
		httpx.ErrorJSON(w, r, code, errCode, msg)
		return
	}
	httpx.JSON(w, http.StatusOK, kp)
}

func (h *Handler) mlsGetGroupState(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	state, err := h.service.MLSGetGroupState(r.Context(), userID, chatID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusForbidden, "access_denied", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, state)
}

func (h *Handler) mlsCommit(w http.ResponseWriter, r *http.Request, userID, chatID, cryptoURL string) {
	var input struct {
		CommitBytes   string `json:"commitBytes"`
		CurrentEpoch  int64  `json:"currentEpoch"`
		TreeStructure string `json:"treeStructure"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	nextEpoch, err := h.service.MLSCommit(r.Context(), userID, chatID, input.CommitBytes, input.CurrentEpoch, input.TreeStructure, cryptoURL)
	if err != nil {
		code := http.StatusBadRequest
		errCode := "commit_failed"
		if strings.Contains(err.Error(), "epoch conflict") {
			code, errCode = http.StatusConflict, "epoch_conflict"
		} else if err.Error() == "access denied" {
			code, errCode = http.StatusForbidden, "access_denied"
		}
		httpx.ErrorJSON(w, r, code, errCode, err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"ok": true, "nextEpoch": nextEpoch})
}

func (h *Handler) mlsStoreWelcome(w http.ResponseWriter, r *http.Request, senderID, chatID, cryptoURL string) {
	var input struct {
		RecipientID  string `json:"recipientId"`
		WelcomeBytes string `json:"welcomeBytes"`
		Epoch        int64  `json:"epoch"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}
	if err := h.service.MLSStoreWelcome(r.Context(), senderID, chatID, input.RecipientID, input.WelcomeBytes, input.Epoch, cryptoURL); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_welcome", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) mlsGetWelcome(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	result, err := h.service.MLSGetWelcome(r.Context(), userID, chatID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusNotFound, "not_found", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, result)
}

func (h *Handler) mlsAddProposal(w http.ResponseWriter, r *http.Request, senderID, chatID, cryptoURL string) {
	var input struct {
		ProposalType  string `json:"proposalType"`
		ProposalBytes string `json:"proposalBytes"`
		Epoch         int64  `json:"epoch"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&input); err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return
	}

	err := h.service.MLSAddProposal(r.Context(), senderID, chatID, input.ProposalType, input.ProposalBytes, input.Epoch, cryptoURL)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusBadRequest, "invalid_proposal", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]bool{"ok": true})
}

func (h *Handler) mlsGetProposals(w http.ResponseWriter, r *http.Request, userID, chatID string) {
	proposals, err := h.service.MLSGetProposals(r.Context(), userID, chatID)
	if err != nil {
		httpx.ErrorJSON(w, r, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}
	httpx.JSON(w, http.StatusOK, proposals)
}
