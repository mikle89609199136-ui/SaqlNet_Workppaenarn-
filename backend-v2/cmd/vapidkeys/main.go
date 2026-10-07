// Command vapidkeys prints a fresh VAPID key pair for Web Push (#717).
//
//	go run ./cmd/vapidkeys
//
// Put the output into the environment of the chat and user services
// (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) and set VAPID_SUBJECT to a
// contact, e.g. mailto:admin@example.com. The private key is a secret:
// store it in the secret storage of the platform, not in the repository.
// Changing the pair invalidates every existing subscription.
package main

import (
	"fmt"
	"log"

	webpush "github.com/SherClockHolmes/webpush-go"
)

func main() {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("VAPID_PUBLIC_KEY=%s\nVAPID_PRIVATE_KEY=%s\n", publicKey, privateKey)
}
