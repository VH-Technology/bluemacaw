# Secrets

bluemacaw is **bring-your-own-key** (BYOK). Each user supplies their own API key per provider; nothing is sent to a bluemacaw backend. Keys are stored in the host OS's native credential manager via the [`keyring`](https://crates.io/crates/keyring) crate.

## Storage backend per platform

| Platform | Backend | Notes |
|---|---|---|
| macOS | Apple Keychain | `apple-native` feature on `keyring` (uses Security.framework). One keychain item per `secret_id`. |
| Windows | Windows Credential Manager | `windows-native` feature. One target per `secret_id`. |

The service name used across all platforms is `bluemacaw` (`secrets::SERVICE_NAME` in `secrets/mod.rs`). The account name is an opaque `secret_id` — in practice, the `api_keys.id` UUID stored in the SQLite db (`migrations/0002_provider_configs.sql`). Storing by UUID rather than by provider id is what lets a user keep multiple keys per provider ("Personal" / "Work") and pin each model config to a specific key. Which keys exist for which provider is read from the `api_keys` table, not from the keychain itself.

## Code surface

```rust
pub trait Vault: Send + Sync {
    fn get(&self, secret_id: &str) -> Result<Option<Zeroizing<String>>, SecretsError>;
    fn set(&self, secret_id: &str, key: &str) -> Result<(), SecretsError>;
    fn delete(&self, secret_id: &str) -> Result<(), SecretsError>;
}
```

Production wires `KeyringVault` (in `secrets/keyring_vault.rs`); tests use `InMemoryVault` (in `secrets/mock.rs`).

The webview accesses the vault exclusively through three Tauri commands defined in `commands.rs`:

- `get_secret(secretId) → string | null`
- `set_secret(secretId, key) → ()`
- `delete_secret(secretId) → ()`

The TS wrapper exposes them as `vox.getSecret`, `vox.setSecret`, `vox.deleteSecret` (`src/lib/invoke.ts`). Discovery of which secret ids exist is a SQL concern handled by `lib/db.ts` against the `api_keys` table.

## Defense in depth

### Zeroization

The `Vault::get` return type is `Option<Zeroizing<String>>` from the [`zeroize`](https://crates.io/crates/zeroize) crate. The buffer is overwritten with zeros when dropped. The `Vault::get` Tauri-command handler immediately destructures with `.map(|z| z.to_string())` to hand the secret to the webview — there is one moment when the cleartext exists in a regular `String` on the way out. Reducing that exposure further would require a custom serializer that streams the secret directly to the webview without intermediate copies; we do not do that today (out of scope for v1; tracked as a future hardening).

### Redacted Debug

The `SecretKey` newtype in `secrets/mod.rs` overrides `Debug`:

```rust
impl std::fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretKey(redacted)")
    }
}
```

A `format!("{:?}", key)` always prints `SecretKey(redacted)`. The repository test `debug_format_redacts_value` asserts the cleartext does not appear and the literal `redacted` does. This is the structural guard against secrets ending up in `log::error!` calls or panic backtraces.

### Telemetry

There is no telemetry. There is no analytics SDK. There is no error-reporting service. The Vault and the secret-handling commands stay entirely on the user's machine.

### Logging

The Rust crate uses `env_logger` (initialized in `lib.rs`). Log lines come from two sources: our own `log::*` calls (which use `SecretKey::Debug`, i.e. always redacted) and `cpal` / `keyring` / `sqlx` / `tauri` itself, none of which receive an API key as a parameter. The webview's `console.log` is captured by Tauri only in dev mode and is never persisted.

## Threat model

### In scope

| Threat | Mitigation |
|---|---|
| Process crash dump containing keys | `Zeroizing` on the boundary, `SecretKey::Debug` redaction. |
| Plaintext keys in app log files | All log call sites use `Debug`; a key never appears in formatted output. |
| Stolen disk image | Keys live in OS keychain (encrypted at rest with the user's login credentials) — not in the SQLite db, not in `tauri-plugin-store`'s `settings.dat`. |
| Accidental telemetry leak | No telemetry exists. |

### Out of scope (v1)

| Threat | Why |
|---|---|
| Malicious local code with the user's UID | A peer process running as the same user can read the keychain. This is the same threat model as the user's browser password manager; we do not solve for it. |
| Memory scraping by another process | Out of scope; would require process-isolation we don't have. |
| Side-channel attacks during secret use | Out of scope. |
| Compromised provider | The blast radius is the user's own account at that provider, which they can revoke and rotate independently. |

## Operating notes

- **CI runners:** the desktop integration tests use `InMemoryVault`; `cargo test --lib` does not touch the real keyring.
- **Rotating a key:** the user opens Settings → API Keys, picks the entry, and replaces the key value. `set_secret` overwrites in place; no separate revoke step is needed at the keychain level. The user must revoke the old key with the provider directly.

## Spec cross-reference

- §6.4 — Storage backends, threat model, redaction strategy.
