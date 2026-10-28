import policy from '../../../../backend-v2/contracts/openapi/media-policy.json';

// Plain uploads use the MIME allowlist; encrypted message files may have any MIME.
export const MEDIA_UPLOAD_POLICY = policy;
