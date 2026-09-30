package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gorilla/websocket"
)

type event struct {
	Type   string `json:"type"`
	ChatID string `json:"chatId"`
}

func main() {
	if len(os.Args) != 5 {
		log.Fatal("usage: ws_client <ws-url> <token> <expected-type> <expected-chat-id>")
	}

	wsURL := os.Args[1]
	token := os.Args[2]
	expectedType := os.Args[3]
	expectedChatID := os.Args[4]

	// Токен — в заголовке: в адресе (?token=) сервер его больше не принимает (#705).
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, http.Header{"Authorization": {"Bearer " + token}})
	if err != nil {
		log.Fatalf("connect: %v", err)
	}
	defer conn.Close()
	fmt.Println("READY")

	if err := conn.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		log.Fatal(err)
	}

	for {
		_, payload, err := conn.ReadMessage()
		if err != nil {
			log.Fatalf("read: %v", err)
		}

		var e event
		if err := json.Unmarshal(payload, &e); err != nil {
			continue
		}

		if e.Type == expectedType && e.ChatID == expectedChatID {
			fmt.Println(string(payload))
			return
		}
	}
}
