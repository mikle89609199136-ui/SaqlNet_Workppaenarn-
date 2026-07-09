package main

import (
	"bufio"
	"database/sql"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	_ "github.com/lib/pq"
)

func main() {
	// 1. Load .env file
	loadEnv("../../.env")

	// 2. Read ports
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	nodePort := os.Getenv("NODE_PORT")
	if nodePort == "" {
		nodePort = "3001"
	}
	dbURL := os.Getenv("DATABASE_URL")

	// 3. Connect and verify DB
	if dbURL != "" {
		db, err := sql.Open("postgres", dbURL)
		if err != nil {
			log.Printf("⚠️ Go Gateway: Failed to open DB connection: %v\n", err)
		} else {
			defer db.Close()
			err = db.Ping()
			if err != nil {
				log.Printf("⚠️ Go Gateway: Failed to ping DB: %v\n", err)
			} else {
				log.Println("✅ Go Gateway: DB Connection verified")
			}
		}
	}

	// 4. Create Reverse Proxy to Node.js backend
	nodeAddr := "http://127.0.0.1:" + nodePort
	targetURL, err := url.Parse(nodeAddr)
	if err != nil {
		log.Fatalf("❌ Go Gateway: Invalid target address: %v\n", err)
	}

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// Customize Director to modify headers correctly
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.Header.Set("X-Forwarded-Host", req.Header.Get("Host"))
		req.Header.Set("X-Real-IP", req.RemoteAddr)
	}

	// 5. Expose HTTP endpoints
	mux := http.NewServeMux()

	// High-performance native Go healthcheck
	mux.HandleFunc("/api/v2/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","gateway":"go","database":"connected"}`))
	})

	// Static files delivery with explicit MIME-types workaround for Debian/Linux environments
	mimeWrapper := func(h http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path
			if strings.HasSuffix(path, ".css") {
				w.Header().Set("Content-Type", "text/css; charset=utf-8")
			} else if strings.HasSuffix(path, ".js") {
				w.Header().Set("Content-Type", "application/javascript; charset=utf-8")
			} else if strings.HasSuffix(path, ".svg") {
				w.Header().Set("Content-Type", "image/svg+xml")
			}
			h.ServeHTTP(w, r)
		})
	}

	clientDir := http.Dir("../../client")
	mux.Handle("/client/", http.StripPrefix("/client/", mimeWrapper(http.FileServer(clientDir))))

	publicDir := http.Dir("../../public")
	mux.Handle("/public/", http.StripPrefix("/public/", mimeWrapper(http.FileServer(publicDir))))

	// Fallback: Proxy everything else to the Node.js backend
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		log.Printf("🔀 Go Gateway: Proxying %s %s\n", r.Method, r.URL.Path)
		proxy.ServeHTTP(w, r)
	})

	// 6. Listen and Serve
	addr := ":" + port
	log.Printf("🦢 Go API Gateway listening on port %s (proxying to Node.js on port %s)\n", port, nodePort)
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("❌ Go Gateway: Failed to start server: %v\n", err)
	}
}

func loadEnv(filename string) {
	file, err := os.Open(filename)
	if err != nil {
		return
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "#") || !strings.Contains(line, "=") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if (strings.HasPrefix(val, "\"") && strings.HasSuffix(val, "\"")) ||
			(strings.HasPrefix(val, "'") && strings.HasSuffix(val, "'")) {
			val = val[1 : len(val)-1]
		}
		os.Setenv(key, val)
	}
}
