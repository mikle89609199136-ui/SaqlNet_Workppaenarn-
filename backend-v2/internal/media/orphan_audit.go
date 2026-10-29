package media

import (
	"context"
	"database/sql"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// AuditOrphans is deliberately read-only. An inventory candidate is not a
// deletion authorization: writes may still be in flight while inventory runs.
func AuditOrphans(ctx context.Context, db *sql.DB, store *MinioStore, bucket string, out io.Writer) error {
	token := ""
	for {
		query := url.Values{"list-type": {"2"}}
		if token != "" {
			query.Set("continuation-token", token)
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, store.endpoint+"/"+escapeS3Path(bucket)+"?"+sortedEncode(query), nil)
		if err != nil {
			return err
		}
		store.signRequest(req, nil)
		response, err := store.client.Do(req)
		if err != nil {
			return err
		}
		if response.StatusCode != http.StatusOK {
			_ = response.Body.Close()
			return fmt.Errorf("object inventory status %d", response.StatusCode)
		}
		var page struct {
			Truncated bool   `xml:"IsTruncated"`
			Next      string `xml:"NextContinuationToken"`
			Objects   []struct {
				Key      string    `xml:"Key"`
				Modified time.Time `xml:"LastModified"`
			} `xml:"Contents"`
		}
		err = xml.NewDecoder(response.Body).Decode(&page)
		_ = response.Body.Close()
		if err != nil {
			return err
		}
		for _, object := range page.Objects {
			var known, live bool
			err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM media.uploads WHERE bucket=$1 AND object_key=$2), media.object_is_referenced($1,$2)`, bucket, object.Key).Scan(&known, &live)
			if err != nil {
				return err
			}
			if live {
				continue
			}
			status := "untracked_candidate"
			if known {
				status = "tracked_unreferenced"
			}
			if err := json.NewEncoder(out).Encode(struct {
				Bucket   string    `json:"bucket"`
				Key      string    `json:"objectKey"`
				Modified time.Time `json:"lastModified"`
				Status   string    `json:"status"`
			}{bucket, object.Key, object.Modified, status}); err != nil {
				return err
			}
		}
		if !page.Truncated {
			return nil
		}
		if page.Next == "" || page.Next == token {
			return fmt.Errorf("object inventory pagination did not advance")
		}
		token = page.Next
	}
}
