package user

import (
	"os"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"
)

const (
	usersContractPath         = "../../contracts/openapi/paths/users.yaml"
	userSchemasContractPath   = "../../contracts/openapi/components/schemas.yaml"
	userResponsesContractPath = "../../contracts/openapi/components/responses.yaml"
)

// TestDeleteAllUserDataOpenAPIContract pins the published contract of DELETE /users/storage/all
// (AC-10): the operation identity, the mandatory confirmation body, the confirmation_required
// error surface and a description that still matches the real runtime behaviour.
func TestDeleteAllUserDataOpenAPIContract(t *testing.T) {
	users := readContract(t, usersContractPath)
	schemas := readContract(t, userSchemasContractPath)
	responses := readContract(t, userResponsesContractPath)

	t.Run("operation identity", func(t *testing.T) {
		operation, ok := nav(users, "/users/storage/all", "delete")
		require.True(t, ok, "в paths/users.yaml нет операции delete у /users/storage/all")
		id, ok := nav(operation, "operationId")
		require.True(t, ok, "у операции нет operationId")
		require.Equal(t, "deleteAllUserData", id)
	})

	t.Run("request body is mandatory", func(t *testing.T) {
		body, ok := nav(users, "/users/storage/all", "delete", "requestBody")
		require.True(t, ok, "у операции нет requestBody")
		required, ok := nav(body, "required")
		require.True(t, ok, "у requestBody нет required")
		require.Equal(t, true, required, "тело запроса должно быть обязательным")
		ref, ok := nav(body, "content", "application/json", "schema", "$ref")
		require.True(t, ok, "тело запроса не описывает схему application/json")
		require.Equal(t, "UserDeleteAllBody", refName(t, ref))
	})

	t.Run("UserDeleteAllBody requires literal confirm", func(t *testing.T) {
		schema, ok := nav(schemas, "UserDeleteAllBody")
		require.True(t, ok, "в components/schemas.yaml нет UserDeleteAllBody")
		required, ok := nav(schema, "required")
		require.True(t, ok, "у UserDeleteAllBody нет required")
		require.Equal(t, []string{"confirm"}, stringList(t, required))
		enum, ok := nav(schema, "properties", "confirm", "enum")
		require.True(t, ok, "у UserDeleteAllBody нет properties.confirm.enum")
		require.Equal(t, []string{"DELETE_ALL_DATA"}, stringList(t, enum))
	})

	t.Run("400 response resolves to confirmation_required", func(t *testing.T) {
		ref, ok := nav(users, "/users/storage/all", "delete", "responses", "400", "$ref")
		require.True(t, ok, "у операции нет ответа 400 со ссылкой на компонент")
		require.Equal(t, "UserConfirmationRequired", refName(t, ref))
		component, ok := nav(responses, "UserConfirmationRequired")
		require.True(t, ok, "в components/responses.yaml нет UserConfirmationRequired")
		schemaRef, ok := nav(component, "content", "application/json", "schema", "$ref")
		require.True(t, ok, "ответ 400 не описывает схему application/json")
		require.Equal(t, "UserConfirmationRequiredBody", refName(t, schemaRef))
		schema, ok := nav(schemas, "UserConfirmationRequiredBody")
		require.True(t, ok, "в components/schemas.yaml нет UserConfirmationRequiredBody")
		require.Equal(t, []string{"confirmation_required"}, codeEnum(t, schema))
	})

	t.Run("x-error-codes lists confirmation_required", func(t *testing.T) {
		codes, ok := nav(users, "/users/storage/all", "delete", "x-error-codes", "400")
		require.True(t, ok, "у операции нет x-error-codes.'400'")
		require.Equal(t, []string{"confirmation_required"}, stringList(t, codes))
	})

	t.Run("summary and description", func(t *testing.T) {
		operation, ok := nav(users, "/users/storage/all", "delete")
		require.True(t, ok, "в paths/users.yaml нет операции delete у /users/storage/all")
		summary, ok := nav(operation, "summary")
		require.True(t, ok, "у операции нет summary")
		require.Contains(t, asText(t, summary), "Permanently delete")
		description, ok := nav(operation, "description")
		require.True(t, ok, "у операции нет description")
		doc := asText(t, description)
		require.NotContains(t, doc, "#448", "описание не должно ссылаться на снятую заметку #448")
		for _, want := range []string{"auth.users", "media.object_cleanup_jobs", "idempotent"} {
			require.Contains(t, doc, want, "описание должно упоминать %s", want)
		}
	})

	t.Run("operation is not deprecated", func(t *testing.T) {
		operation, ok := nav(users, "/users/storage/all", "delete")
		require.True(t, ok, "в paths/users.yaml нет операции delete у /users/storage/all")
		value, present := nav(operation, "deprecated")
		if !present {
			return
		}
		deprecated, isBool := value.(bool)
		require.Truef(t, isBool, "deprecated должен быть bool, получено %T", value)
		require.False(t, deprecated, "операция не должна быть помечена deprecated")
	})
}

// readContract parses one fragment of the published OpenAPI contract relative to the package
// directory, the same way other contract tests in this repository read YAML files.
func readContract(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	require.NoErrorf(t, err, "не удалось прочитать %s", path)
	var document map[string]any
	require.NoErrorf(t, yaml.Unmarshal(data, &document), "не удалось разобрать %s", path)
	return document
}

// nav walks nested mappings by key. The boolean result becomes false as soon as a step is
// missing or is not a mapping, so every check reports its own failure instead of aborting.
func nav(node any, keys ...string) (any, bool) {
	current := node
	for _, key := range keys {
		mapping, ok := current.(map[string]any)
		if !ok {
			return nil, false
		}
		if current, ok = mapping[key]; !ok {
			return nil, false
		}
	}
	return current, true
}

// refName returns the component name of a reference such as ../schemas.yaml#/UserDeleteAllBody.
func refName(t *testing.T, node any) string {
	t.Helper()
	ref, ok := node.(string)
	require.Truef(t, ok, "$ref должен быть строкой, получено %T", node)
	_, name, found := strings.Cut(ref, "#/")
	require.Truef(t, found, "$ref %q не указывает на компонент", ref)
	return name
}

// stringList converts a YAML sequence of scalars into strings for exact comparison.
func stringList(t *testing.T, node any) []string {
	t.Helper()
	items, ok := node.([]any)
	require.Truef(t, ok, "ожидался список, получено %T", node)
	values := make([]string, 0, len(items))
	for _, item := range items {
		value, ok := item.(string)
		require.Truef(t, ok, "ожидалась строка, получено %T", item)
		values = append(values, value)
	}
	return values
}

// asText returns a scalar string value.
func asText(t *testing.T, node any) string {
	t.Helper()
	value, ok := node.(string)
	require.Truef(t, ok, "ожидалась строка, получено %T", node)
	return value
}

// codeEnum digs the enum declared for properties.code out of a possibly allOf-composed body.
func codeEnum(t *testing.T, schema any) []string {
	t.Helper()
	if enum, ok := nav(schema, "properties", "code", "enum"); ok {
		return stringList(t, enum)
	}
	branches, ok := nav(schema, "allOf")
	require.True(t, ok, "схема тела не объявляет properties.code.enum")
	items, isList := branches.([]any)
	require.True(t, isList, "allOf должен быть списком")
	for _, branch := range items {
		if enum, ok := nav(branch, "properties", "code", "enum"); ok {
			return stringList(t, enum)
		}
	}
	require.Fail(t, "allOf-ветви не объявляют properties.code.enum")
	return nil
}
