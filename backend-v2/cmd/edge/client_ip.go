package main

import (
	"fmt"
	"net/http"
	"net/netip"
	"strings"
)

type trustedProxySet struct {
	prefixes []netip.Prefix
}

func (s trustedProxySet) contains(ip netip.Addr) bool {
	for _, prefix := range s.prefixes {
		if prefix.Contains(ip) {
			return true
		}
	}
	return false
}

func parseTrustedProxies(value string) (trustedProxySet, error) {
	if strings.TrimSpace(value) == "" {
		return trustedProxySet{}, nil
	}

	var prefixes []netip.Prefix
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			return trustedProxySet{}, fmt.Errorf("trusted proxy list contains an empty entry")
		}
		if strings.Contains(part, "/") {
			prefix, err := netip.ParsePrefix(part)
			if err != nil {
				return trustedProxySet{}, fmt.Errorf("invalid CIDR prefix %q: %w", part, err)
			}
			prefixes = append(prefixes, prefix)
		} else {
			ip, err := netip.ParseAddr(part)
			if err != nil {
				return trustedProxySet{}, fmt.Errorf("invalid IP address %q: %w", part, err)
			}
			prefixes = append(prefixes, netip.PrefixFrom(ip, ip.BitLen()))
		}
	}
	return trustedProxySet{prefixes: prefixes}, nil
}

func (s trustedProxySet) clientIP(r *http.Request) string {
	addrPort, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	remoteIP := addrPort.Addr().Unmap()
	if !s.contains(remoteIP) {
		return remoteIP.String()
	}

	forwardedFor := strings.TrimSpace(r.Header.Get("X-Forwarded-For"))
	if forwardedFor == "" {
		return remoteIP.String()
	}

	parts := strings.Split(forwardedFor, ",")
	clientIP := remoteIP

	for i := len(parts) - 1; i >= 0; i-- {
		candidate, err := netip.ParseAddr(strings.TrimSpace(parts[i]))
		if err != nil {
			return remoteIP.String()
		}

		candidate = candidate.Unmap()
		clientIP = candidate

		if !s.contains(clientIP) {
			return clientIP.String()
		}
	}

	return clientIP.String()
}
