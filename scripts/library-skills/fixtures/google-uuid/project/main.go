package main

import (
	"encoding/json"
	"fmt"
	"runtime"
	"runtime/debug"

	"github.com/google/uuid"
)

func require(condition bool, message string) {
	if condition {
		return
	}
	panic(message)
}

func main() {
	canonical := "f81d4fae-7dec-11d0-a765-00a0c91e6bf6"
	parsed, err := uuid.Parse(canonical)
	require(err == nil, "parse canonical UUID")
	require(parsed.String() == canonical, "canonical round-trip")
	require(parsed.Version() == 1, "parsed UUID version")
	require(parsed.Variant() == uuid.RFC4122, "parsed UUID variant")
	_, err = uuid.Parse("not-a-uuid")
	require(err != nil, "reject invalid UUID")
	compact := "f81d4fae7dec11d0a76500a0c91e6bf6"
	permissive, err := uuid.Parse(compact)
	require(err == nil, "Parse accepts compact UUID input")
	require(permissive.String() != compact, "canonical-only policy needs an explicit boundary")
	generated, err := uuid.NewRandom()
	require(err == nil, "generate random UUID")
	require(generated.Version() == 4, "random UUID version")
	require(generated.Variant() == uuid.RFC4122, "random UUID variant")
	encoded, err := json.Marshal(generated)
	require(err == nil, "serialize UUID")
	var decoded uuid.UUID
	err = json.Unmarshal(encoded, &decoded)
	require(err == nil, "deserialize UUID")
	require(decoded == generated, "JSON UUID round-trip")
	info, ok := debug.ReadBuildInfo()
	require(ok, "build dependency evidence")
	version := ""
	for _, dependency := range info.Deps {
		if dependency.Path == "github.com/google/uuid" {
			version = dependency.Version
		}
	}
	require(version == "v1.6.0", "selected UUID dependency version")
	checks := []string{"canonical UUID parse and version", "invalid input rejection and permissive parse boundary", "random UUID version and variant", "UUID JSON round-trip"}
	evidence := map[string]any{"productId": "google-uuid", "ecosystem": "go", "targetIdentity": "github.com/google/uuid", "packages": map[string]string{"github.com/google/uuid": version}, "checks": checks, "examplesExecuted": len(checks), "environment": runtime.Version()}
	result, err := json.Marshal(evidence)
	require(err == nil, "serialize evidence")
	fmt.Println(string(result))
}
