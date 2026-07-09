use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use axum::{
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    env,
    net::SocketAddr,
    time::{SystemTime, UNIX_EPOCH},
};

type HmacSha256 = Hmac<Sha256>;
type ApiResult<T> = Result<Json<T>, (StatusCode, Json<ApiError>)>;

#[derive(Serialize)]
struct ApiError {
    code: &'static str,
    message: String,
}

#[derive(Deserialize)]
struct PasswordRequest {
    password: String,
}

#[derive(Deserialize)]
struct VerifyPasswordRequest {
    password: String,
    hash: String,
}

#[derive(Serialize)]
struct HashResponse {
    hash: String,
}

#[derive(Serialize)]
struct ValidResponse {
    valid: bool,
}

#[derive(Deserialize)]
struct IssueTokenRequest {
    subject: String,
    username: String,
}

#[derive(Deserialize)]
struct VerifyTokenRequest {
    token: String,
}

#[derive(Serialize, Deserialize)]
struct TokenClaims {
    #[serde(rename = "sub")]
    subject: String,
    #[serde(rename = "userId", default)]
    user_id: String,
    username: String,
    #[serde(rename = "iat")]
    issued_at: u64,
    #[serde(rename = "exp")]
    expires_at: u64,
}

#[derive(Serialize)]
struct IssueTokenResponse {
    token: String,
    expires_at: u64,
}

#[derive(Serialize)]
struct VerifyTokenResponse {
    subject: String,
    username: String,
    issued_at: u64,
    expires_at: u64,
}

#[derive(Deserialize)]
struct CipherRequest {
    data: String,
    #[serde(default)]
    associated_data: String,
}

#[derive(Serialize)]
struct CipherResponse {
    data: String,
}

#[derive(Deserialize)]
struct KeyVerificationRequest {
    key_id: String,
    public_key: String,
}

#[derive(Serialize)]
struct KeyVerificationResponse {
    valid: bool,
    checksum: String,
}

#[derive(Deserialize)]
struct ValidateKeyPackageRequest {
    keypackage_bytes: String,
}

#[derive(Serialize)]
struct ValidateKeyPackageResponse {
    valid: bool,
    key_id: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct ValidateCommitRequest {
    commit_bytes: String,
    current_epoch: u64,
}

#[derive(Serialize)]
struct ValidateCommitResponse {
    valid: bool,
    next_epoch: Option<u64>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct ValidateWelcomeRequest {
    welcome_bytes: String,
}

#[tokio::main]
async fn main() {
    require_secret("CRYPTO_SIGNING_SECRET");
    require_secret("CRYPTO_ENCRYPTION_SECRET");

    let app = Router::new()
        .route("/health/live", get(health))
        .route("/health/ready", get(health))
        .route("/internal/v1/password/hash", post(hash_password))
        .route("/internal/v1/password/verify", post(verify_password))
        .route("/internal/v1/token/issue", post(issue_token))
        .route("/internal/v1/token/verify", post(verify_token))
        .route("/internal/v1/encrypt", post(encrypt))
        .route("/internal/v1/decrypt", post(decrypt))
        .route("/api/v2/crypto/verify-key", post(verify_key))
        .route("/api/v2/crypto/mls/validate-keypackage", post(validate_keypackage))
        .route("/api/v2/crypto/mls/validate-commit", post(validate_commit))
        .route("/api/v2/crypto/mls/validate-welcome", post(validate_welcome));

    let port = env::var("CRYPTO_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(5005);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("Rust Crypto Service running on {}", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({"status": "ok"}))
}

async fn hash_password(Json(payload): Json<PasswordRequest>) -> ApiResult<HashResponse> {
    if payload.password.len() < 10 || payload.password.len() > 1024 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_password", "password length must be between 10 and 1024"));
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(payload.password.as_bytes(), &salt)
        .map_err(internal)?
        .to_string();
    Ok(Json(HashResponse { hash }))
}

async fn verify_password(Json(payload): Json<VerifyPasswordRequest>) -> ApiResult<ValidResponse> {
    let parsed = PasswordHash::new(&payload.hash)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_hash", "password hash is malformed"))?;
    let valid = Argon2::default()
        .verify_password(payload.password.as_bytes(), &parsed)
        .is_ok();
    Ok(Json(ValidResponse { valid }))
}

async fn issue_token(Json(payload): Json<IssueTokenRequest>) -> ApiResult<IssueTokenResponse> {
    if payload.subject.is_empty() || payload.username.is_empty() {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_claims", "subject and username are required"));
    }
    let issued_at = unix_time();
    let expires_at = issued_at + token_ttl();
    let claims = TokenClaims {
        subject: payload.subject.clone(),
        user_id: payload.subject,
        username: payload.username,
        issued_at,
        expires_at,
    };
    let header = general_purpose::URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
    let body = general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(&claims).map_err(internal)?);
    let signing_input = format!("{header}.{body}");
    let signature = sign(signing_input.as_bytes())?;
    Ok(Json(IssueTokenResponse {
        token: format!("{signing_input}.{signature}"),
        expires_at,
    }))
}

async fn verify_token(Json(payload): Json<VerifyTokenRequest>) -> ApiResult<VerifyTokenResponse> {
    let parts: Vec<&str> = payload.token.split('.').collect();
    if parts.len() != 3 {
        return Err(error(StatusCode::UNAUTHORIZED, "invalid_token", "token is malformed"));
    }
    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let expected_signature = sign(signing_input.as_bytes())?;
    let supplied_signature = parts[2];
    if !constant_time_eq(expected_signature.as_bytes(), supplied_signature.as_bytes()) {
        return Err(error(StatusCode::UNAUTHORIZED, "invalid_token", "token signature is invalid"));
    }
    let claims: TokenClaims = serde_json::from_slice(
        &general_purpose::URL_SAFE_NO_PAD
            .decode(parts[1])
            .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_token", "token body is malformed"))?,
    )
    .map_err(|_| error(StatusCode::UNAUTHORIZED, "invalid_token", "token claims are malformed"))?;
    if claims.expires_at <= unix_time() {
        return Err(error(StatusCode::UNAUTHORIZED, "token_expired", "token has expired"));
    }
    Ok(Json(VerifyTokenResponse {
        subject: claims.subject,
        username: claims.username,
        issued_at: claims.issued_at,
        expires_at: claims.expires_at,
    }))
}

async fn encrypt(Json(payload): Json<CipherRequest>) -> ApiResult<CipherResponse> {
    let plaintext = general_purpose::STANDARD
        .decode(payload.data)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_base64", "data is not valid base64"))?;
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut nonce_bytes);
    let cipher = encryption_cipher()?;
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce_bytes),
            Payload { msg: &plaintext, aad: payload.associated_data.as_bytes() },
        )
        .map_err(internal)?;
    let mut envelope = nonce_bytes.to_vec();
    envelope.extend(ciphertext);
    Ok(Json(CipherResponse { data: general_purpose::STANDARD.encode(envelope) }))
}

async fn decrypt(Json(payload): Json<CipherRequest>) -> ApiResult<CipherResponse> {
    let envelope = general_purpose::STANDARD
        .decode(payload.data)
        .map_err(|_| error(StatusCode::BAD_REQUEST, "invalid_base64", "data is not valid base64"))?;
    if envelope.len() < 28 {
        return Err(error(StatusCode::BAD_REQUEST, "invalid_ciphertext", "ciphertext is too short"));
    }
    let plaintext = encryption_cipher()?
        .decrypt(
            Nonce::from_slice(&envelope[..12]),
            Payload { msg: &envelope[12..], aad: payload.associated_data.as_bytes() },
        )
        .map_err(|_| error(StatusCode::BAD_REQUEST, "decryption_failed", "ciphertext or associated data is invalid"))?;
    Ok(Json(CipherResponse { data: general_purpose::STANDARD.encode(plaintext) }))
}

async fn verify_key(Json(payload): Json<KeyVerificationRequest>) -> Json<KeyVerificationResponse> {
    let decoded = general_purpose::STANDARD.decode(&payload.public_key);
    let valid = payload.key_id.len() >= 16 && decoded.as_ref().is_ok_and(|value| value.len() >= 32);
    let checksum = decoded
        .map(|value| hex::encode(Sha256::digest(value)))
        .unwrap_or_default();
    Json(KeyVerificationResponse { valid, checksum })
}

async fn validate_keypackage(Json(payload): Json<ValidateKeyPackageRequest>) -> Json<ValidateKeyPackageResponse> {
    // Expect a P-256 raw uncompressed public key: 65 bytes, first byte 0x04
    match decode_artifact(&payload.keypackage_bytes, 65) {
        Ok(bytes) => {
            if bytes.len() != 65 || bytes[0] != 0x04 {
                return Json(ValidateKeyPackageResponse {
                    valid: false,
                    key_id: None,
                    error: Some("keypackage must be a 65-byte P-256 uncompressed point (0x04 prefix)".to_string()),
                });
            }
            Json(ValidateKeyPackageResponse {
                valid: true,
                key_id: Some(hex::encode(Sha256::digest(&bytes))),
                error: None,
            })
        }
        Err(_) => Json(ValidateKeyPackageResponse {
            valid: false,
            key_id: None,
            error: Some("invalid keypackage encoding".to_string()),
        }),
    }
}

async fn validate_commit(Json(payload): Json<ValidateCommitRequest>) -> Json<ValidateCommitResponse> {
    // Commit authenticator must be exactly 32 bytes (HKDF-SHA256 output)
    match decode_artifact(&payload.commit_bytes, 32) {
        Ok(bytes) => {
            if bytes.len() != 32 {
                return Json(ValidateCommitResponse {
                    valid: false,
                    next_epoch: None,
                    error: Some("commit_bytes must be exactly 32 bytes".to_string()),
                });
            }
            Json(ValidateCommitResponse { valid: true, next_epoch: Some(payload.current_epoch + 1), error: None })
        }
        Err(_) => Json(ValidateCommitResponse {
            valid: false,
            next_epoch: None,
            error: Some("invalid commit encoding".to_string()),
        }),
    }
}

async fn validate_welcome(Json(payload): Json<ValidateWelcomeRequest>) -> Json<ValidResponse> {
    // Welcome contains ephemeralPub (65B) + iv (12B) + sealed (32B+tag) encoded as JSON+base64
    // Minimum meaningful size: 64 bytes decoded
    Json(ValidResponse { valid: decode_artifact(&payload.welcome_bytes, 64).is_ok() })
}

fn sign(body: &[u8]) -> Result<String, (StatusCode, Json<ApiError>)> {
    let mut mac = <HmacSha256 as Mac>::new_from_slice(required_secret("CRYPTO_SIGNING_SECRET").as_bytes()).map_err(internal)?;
    mac.update(body);
    Ok(general_purpose::URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes()))
}

fn encryption_cipher() -> Result<Aes256Gcm, (StatusCode, Json<ApiError>)> {
    let key = Sha256::digest(required_secret("CRYPTO_ENCRYPTION_SECRET").as_bytes());
    Aes256Gcm::new_from_slice(&key).map_err(internal)
}

fn decode_artifact(value: &str, minimum: usize) -> Result<Vec<u8>, String> {
    let bytes = general_purpose::STANDARD.decode(value).map_err(|_| "invalid base64 encoding".to_string())?;
    if bytes.len() < minimum {
        return Err(format!("artifact must be at least {minimum} bytes"));
    }
    Ok(bytes)
}

fn required_secret(name: &str) -> String {
    env::var(name).unwrap_or_else(|_| panic!("{name} is required"))
}

fn require_secret(name: &str) {
    let value = required_secret(name);
    assert!(value.len() >= 32, "{name} must be at least 32 characters");
}

fn token_ttl() -> u64 {
    env::var("CRYPTO_TOKEN_TTL_SECONDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(30 * 24 * 3600) // 30 days
}

fn unix_time() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter().zip(right).fold(0u8, |difference, (a, b)| difference | (a ^ b)) == 0
}

fn error(status: StatusCode, code: &'static str, message: impl Into<String>) -> (StatusCode, Json<ApiError>) {
    (status, Json(ApiError { code, message: message.into() }))
}

fn internal(error_value: impl std::fmt::Display) -> (StatusCode, Json<ApiError>) {
    eprintln!("crypto operation failed: {error_value}");
    error(StatusCode::INTERNAL_SERVER_ERROR, "crypto_failure", "cryptographic operation failed")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constant_time_comparison_handles_equal_and_different_values() {
        assert!(constant_time_eq(b"same", b"same"));
        assert!(!constant_time_eq(b"same", b"diff"));
        assert!(!constant_time_eq(b"short", b"longer"));
    }

    #[test]
    fn artifact_validation_rejects_short_data() {
        let encoded = general_purpose::STANDARD.encode([1u8; 8]);
        assert!(decode_artifact(&encoded, 16).is_err());
    }

    #[test]
    fn password_hash_and_verify() {
        let password = "my_secure_password";
        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2.hash_password(password.as_bytes(), &salt).unwrap().to_string();
        
        let parsed_hash = PasswordHash::new(&password_hash).unwrap();
        assert!(argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok());
        assert!(argon2.verify_password("wrong_password".as_bytes(), &parsed_hash).is_err());
    }
}
