package user

import "testing"

func TestJSONMapScanAndValue(t *testing.T) {
	var decoded jsonMap
	if err := decoded.Scan([]byte(`{"theme":"dark"}`)); err != nil {
		t.Fatalf("scan json map: %v", err)
	}
	if decoded["theme"] != "dark" {
		t.Fatalf("expected theme dark, got %#v", decoded["theme"])
	}
	value, err := decoded.Value()
	if err != nil {
		t.Fatalf("value json map: %v", err)
	}
	if len(value.([]byte)) == 0 {
		t.Fatal("expected non-empty json value")
	}
}

func TestPQStringArrayScan(t *testing.T) {
	var values pqStringArray
	if err := values.Scan([]byte(`{developer,premium}`)); err != nil {
		t.Fatalf("scan string array: %v", err)
	}
	if len(values) != 2 || values[0] != "developer" || values[1] != "premium" {
		t.Fatalf("unexpected array values: %#v", values)
	}
}
