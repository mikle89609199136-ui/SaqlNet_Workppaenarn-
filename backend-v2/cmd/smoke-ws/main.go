package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
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
		log.Fatal("usage: ws_client <ws-url> <cookie> <expected-type> <expected-chat-id>")
	}

	wsURL := os.Args[1]
	cookie := os.Args[2]
	expectedType := os.Args[3]
	expectedChatID := os.Args[4]

	parsed, err := url.Parse(wsURL)
	if err != nil {
		log.Fatalf("invalid ws URL: %v", err)
	}
	originScheme := "http"
	if parsed.Scheme == "wss" {
		originScheme = "https"
	}
	header := http.Header{
		"Cookie": {cookie},
		"Origin": {originScheme + "://" + parsed.Host},
	}
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, header)
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
