package chat

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

func TestDialNATSAuthenticatesAndFlushesPublish(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	result := make(chan error, 1)
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			result <- err
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))
		_, _ = fmt.Fprint(conn, "INFO {\"server_id\":\"test\",\"version\":\"2.10.0\",\"proto\":1,\"auth_required\":true,\"max_payload\":1048576}\r\n")
		reader := bufio.NewReader(conn)
		published := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				result <- err
				return
			}
			switch {
			case strings.HasPrefix(line, "CONNECT "):
				var auth struct {
					User string `json:"user"`
					Pass string `json:"pass"`
				}
				if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(line, "CONNECT "))), &auth); err != nil {
					result <- err
					return
				}
				if auth.User != "cloud-user" || auth.Pass != "cloud-password" {
					result <- fmt.Errorf("missing cloud credentials")
					return
				}
			case strings.HasPrefix(line, "PUB "):
				if line != "PUB test.event 5\r\n" {
					result <- fmt.Errorf("unexpected publish header")
					return
				}
				payload := make([]byte, 7)
				if _, err := io.ReadFull(reader, payload); err != nil {
					result <- err
					return
				}
				if string(payload) != "hello\r\n" {
					result <- fmt.Errorf("unexpected payload")
					return
				}
				published = true
			case line == "PING\r\n":
				_, _ = fmt.Fprint(conn, "PONG\r\n")
				if published {
					result <- nil
					return
				}
			}
		}
	}()
	client, err := DialNATS("nats://cloud-user:cloud-password@" + listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	if err := client.Publish("test.event", []byte("hello")); err != nil {
		t.Fatal(err)
	}
	if err := <-result; err != nil {
		t.Fatal(err)
	}
}
