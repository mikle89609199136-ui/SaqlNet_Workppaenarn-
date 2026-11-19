package user_test

import (
	"maps"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"go.yaml.in/yaml/v3"
)

// loadContract читает YAML контракта относительно каталога пакета.
func loadContract(t *testing.T, relPath string, out any) {
	t.Helper()
	data, err := os.ReadFile("../../" + relPath)
	require.NoError(t, err)
	require.NoError(t, yaml.Unmarshal(data, out))
}

func TestStorageOpenAPIDocumentsFourCategories(t *testing.T) {
	var doc struct {
		StorageUsage struct {
			Properties map[string]struct{ Description string } `yaml:"properties"`
		} `yaml:"StorageUsage"`
	}
	loadContract(t, "contracts/openapi/components/schemas.yaml", &doc)
	props := doc.StorageUsage.Properties
	require.Len(t, props, 4)
	needles := map[string][]string{
		"messages": {"length", "character count"},
		"media":    {"purpose <> 'avatar'", "bytes"},
		"files":    {"like 'application/*'", "bytes"},
		"cache":    {"0", "#446"},
	}
	for name, wants := range needles {
		text := strings.ToLower(props[name].Description)
		require.NotContains(t, text, "#445", name)
		require.NotContains(t, text, "placeholder", name)
		for _, want := range wants {
			require.Contains(t, text, want, name)
		}
	}
}

func TestStorageOpenAPIZeroCategoriesMarked(t *testing.T) {
	var doc struct {
		Path struct {
			Get struct {
				Description  string
				ContractGaps []string `yaml:"x-contract-gaps"`
			} `yaml:"get"`
		} `yaml:"/users/storage"`
	}
	loadContract(t, "contracts/openapi/paths/users.yaml", &doc)
	op := doc.Path.Get
	require.Equal(t, []string{"#446"}, op.ContractGaps)
	require.NotContains(t, op.Description, "#445")
	require.Contains(t, op.Description, "always 0")
	require.Contains(t, op.Description, "#446")
}

type refHolder struct {
	Schema struct {
		Ref *string `yaml:"$ref"`
	} `yaml:"schema"`
}

type storageResponse struct {
	Ref         *string `yaml:"$ref"`
	Description *string `yaml:"description"`
	Headers     map[string]struct {
		Schema struct {
			Type *string  `yaml:"type"`
			Enum []string `yaml:"enum"`
		} `yaml:"schema"`
	} `yaml:"headers"`
	Content map[string]refHolder `yaml:"content"`
}

func TestStorageOpenAPIMethodSurfaceUnchanged(t *testing.T) {
	var doc struct {
		Path struct {
			Get struct {
				Responses  map[string]*storageResponse `yaml:"responses"`
				ErrorCodes map[string][]string         `yaml:"x-error-codes"`
			} `yaml:"get"`
		} `yaml:"/users/storage"`
	}
	loadContract(t, "contracts/openapi/paths/users.yaml", &doc)
	op := doc.Path.Get
	refused := op.Responses["405"]
	require.NotNil(t, refused, "405 present")
	require.Nil(t, refused.Ref, "405 is inline, not $ref")
	require.NotNil(t, refused.Description, "405 description")
	require.NotEmpty(t, *refused.Description)
	allow, ok := refused.Headers["Allow"]
	require.True(t, ok, "Allow header")
	require.NotNil(t, allow.Schema.Type)
	require.Equal(t, "string", *allow.Schema.Type)
	require.Equal(t, []string{"GET"}, allow.Schema.Enum)
	require.Equal(t, []string{"401", "405", "429", "500", "502", "503"}, slices.Sorted(maps.Keys(op.ErrorCodes)))
	ok200 := op.Responses["200"]
	require.NotNil(t, ok200, "200 present")
	media := ok200.Content["application/json"]
	require.NotNil(t, media.Schema.Ref, "200 $ref")
	require.True(t, strings.HasSuffix(*media.Schema.Ref, "#/StorageResponse"))
	var schemas struct {
		StorageResponse struct {
			Properties map[string]struct {
				Ref *string `yaml:"$ref"`
			} `yaml:"properties"`
		} `yaml:"StorageResponse"`
	}
	loadContract(t, "contracts/openapi/components/schemas.yaml", &schemas)
	props := schemas.StorageResponse.Properties
	require.NotNil(t, props["storage"].Ref, "storage $ref")
	require.True(t, strings.HasSuffix(*props["storage"].Ref, "#/StorageUsage"))
	require.NotNil(t, props["settings"].Ref, "settings $ref")
	require.True(t, strings.HasSuffix(*props["settings"].Ref, "#/LegacyStorageSettings"))
}
