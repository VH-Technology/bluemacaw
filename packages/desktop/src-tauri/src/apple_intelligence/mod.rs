//! On-device transcript cleanup with Apple Intelligence (macOS 27+).
//!
//! Apple exposes its on-device foundation model only through the Swift-only
//! `FoundationModels` framework. The main binary targets macOS 10.15 and has
//! no Swift in it; linking Swift concurrency + FoundationModels into it would
//! mean back-deploying and weak-linking the Swift runtime just to keep older
//! macOS versions launching. Instead, `build.rs` compiles
//! `swift/apple-intelligence/main.swift` into a small sidecar executable that
//! `tauri.macos.conf.json` bundles next to the main binary
//! (`Contents/MacOS/bluemacaw-apple-intelligence`). This module gates on the
//! macOS version, spawns the sidecar, and speaks its one-shot JSON protocol
//! (documented at the top of `main.swift`).

// Everything below the public entry points only runs on macOS; the rest of the
// module still compiles elsewhere so the protocol tests run on every CI OS.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// First macOS major version on which bluemacaw offers Apple Intelligence cleanup.
pub const MIN_MACOS_MAJOR: u32 = 27;

/// Sidecar file name. Tauri strips the `-<target-triple>` suffix from
/// `binaries/` when it copies the sidecar next to the main executable.
pub const HELPER_NAME: &str = "bluemacaw-apple-intelligence";

/// Availability probes answer in milliseconds; the budget only matters if the
/// sidecar hangs.
const STATUS_TIMEOUT: Duration = Duration::from_secs(10);

/// Upper bound for one rewrite. Typical dictations finish in a second or two;
/// the budget covers multi-minute dictations and a cold model load. The
/// webview falls back to the raw transcript when it runs out.
pub const GENERATE_TIMEOUT: Duration = Duration::from_secs(30);

/// Whether Apple's on-device model can post-process transcripts, as sent to
/// the webview: `{"status":"available"}` or
/// `{"status":"unavailable","reason":"model-not-ready"}`. The sidecar prints
/// the same shape, so its output deserializes straight into this type.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum AppleIntelligenceStatus {
    Available,
    Unavailable { reason: UnavailableReason },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum UnavailableReason {
    /// Not macOS.
    UnsupportedPlatform,
    /// macOS older than [`MIN_MACOS_MAJOR`].
    UnsupportedOs,
    /// The sidecar was compiled against an SDK without FoundationModels.
    UnsupportedBuild,
    DeviceNotEligible,
    AppleIntelligenceNotEnabled,
    /// Model assets are still downloading or otherwise not ready.
    ModelNotReady,
    /// Missing sidecar, crash, timeout, unparseable output, or a reason
    /// introduced by a newer OS.
    #[serde(other)]
    Unknown,
}

fn unavailable(reason: UnavailableReason) -> AppleIntelligenceStatus {
    AppleIntelligenceStatus::Unavailable { reason }
}

/// Probe the model. Never fails: every problem maps to an unavailable reason.
pub async fn status() -> AppleIntelligenceStatus {
    #[cfg(target_os = "macos")]
    {
        match helper_path() {
            Some(helper) => status_with(&helper, macos_major_version()).await,
            None => unavailable(UnavailableReason::Unknown),
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        unavailable(UnavailableReason::UnsupportedPlatform)
    }
}

/// Run `prompt` through the on-device model with `instructions` as the
/// session instructions, returning the model's reply.
pub async fn generate(instructions: &str, prompt: &str) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        let helper = helper_path()
            .ok_or_else(|| "could not locate the Apple Intelligence helper".to_string())?;
        generate_with(
            &helper,
            macos_major_version(),
            instructions,
            prompt,
            GENERATE_TIMEOUT,
        )
        .await
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (instructions, prompt);
        Err("Apple Intelligence is only available on macOS".to_string())
    }
}

async fn status_with(helper: &Path, os_major: Option<u32>) -> AppleIntelligenceStatus {
    if let Err(reason) = check_os(os_major) {
        return unavailable(reason);
    }
    match run_helper(helper, "status", None, STATUS_TIMEOUT).await {
        Ok(output) => parse_status(&output.stdout),
        Err(e) => {
            log::warn!("Apple Intelligence status probe failed: {e}");
            unavailable(UnavailableReason::Unknown)
        }
    }
}

#[derive(Serialize)]
struct GenerateRequest<'a> {
    instructions: &'a str,
    prompt: &'a str,
}

#[derive(Deserialize)]
struct GenerateResponse {
    text: Option<String>,
    error: Option<String>,
}

async fn generate_with(
    helper: &Path,
    os_major: Option<u32>,
    instructions: &str,
    prompt: &str,
    timeout: Duration,
) -> Result<String, String> {
    check_os(os_major).map_err(|_| {
        format!("Apple Intelligence cleanup requires macOS {MIN_MACOS_MAJOR} or later")
    })?;
    let request = serde_json::to_vec(&GenerateRequest {
        instructions,
        prompt,
    })
    .map_err(|e| e.to_string())?;
    let output = run_helper(helper, "generate", Some(request), timeout).await?;
    match serde_json::from_slice::<GenerateResponse>(&output.stdout) {
        Ok(GenerateResponse {
            text: Some(text), ..
        }) if output.success => Ok(text),
        Ok(GenerateResponse {
            error: Some(error), ..
        }) => Err(format!("Apple Intelligence: {error}")),
        _ => Err(format!(
            "Apple Intelligence helper exited unexpectedly: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )),
    }
}

/// The sidecar targets macOS 26 and can't even launch on older systems, so
/// this gate runs before any spawn.
fn check_os(os_major: Option<u32>) -> Result<(), UnavailableReason> {
    match os_major {
        Some(major) if major >= MIN_MACOS_MAJOR => Ok(()),
        _ => Err(UnavailableReason::UnsupportedOs),
    }
}

fn parse_status(stdout: &[u8]) -> AppleIntelligenceStatus {
    serde_json::from_slice(stdout).unwrap_or(unavailable(UnavailableReason::Unknown))
}

struct HelperOutput {
    success: bool,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

/// Spawn the sidecar with `subcommand`, feed it `stdin`, and collect its
/// output. The sidecar is killed if it outlives `timeout`.
async fn run_helper(
    helper: &Path,
    subcommand: &str,
    stdin: Option<Vec<u8>>,
    timeout: Duration,
) -> Result<HelperOutput, String> {
    use std::process::Stdio;
    use tokio::io::AsyncWriteExt;

    let mut child = tokio::process::Command::new(helper)
        .arg(subcommand)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("could not launch {}: {e}", helper.display()))?;

    let pipe = child.stdin.take();
    let feed = async move {
        if let (Some(mut pipe), Some(bytes)) = (pipe, stdin) {
            // A sidecar that exits early closes its end; its output says why,
            // so a failed write isn't an error of its own. Dropping `pipe`
            // afterwards sends EOF.
            let _ = pipe.write_all(&bytes).await;
        }
    };
    let (_, output) = tokio::time::timeout(timeout, async {
        tokio::join!(feed, child.wait_with_output())
    })
    .await
    .map_err(|_| {
        format!(
            "Apple Intelligence did not respond within {} seconds",
            timeout.as_secs_f32()
        )
    })?;
    let output = output.map_err(|e| format!("Apple Intelligence helper failed: {e}"))?;
    Ok(HelperOutput {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
}

/// Tauri installs sidecars next to the main executable: `target/<profile>/`
/// under `tauri dev`, `Contents/MacOS/` in the bundle.
fn helper_path() -> Option<PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.join(HELPER_NAME))
}

#[cfg(target_os = "macos")]
fn macos_major_version() -> Option<u32> {
    let version = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersion();
    u32::try_from(version.majorVersion).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn status_serializes_for_the_webview() {
        assert_eq!(
            serde_json::to_value(AppleIntelligenceStatus::Available).unwrap(),
            json!({ "status": "available" })
        );
        assert_eq!(
            serde_json::to_value(unavailable(UnavailableReason::AppleIntelligenceNotEnabled))
                .unwrap(),
            json!({ "status": "unavailable", "reason": "apple-intelligence-not-enabled" })
        );
    }

    #[test]
    fn parse_status_reads_the_sidecar_reasons() {
        assert_eq!(
            parse_status(b"{\"status\":\"available\"}\n"),
            AppleIntelligenceStatus::Available
        );
        for (wire, reason) in [
            ("device-not-eligible", UnavailableReason::DeviceNotEligible),
            (
                "apple-intelligence-not-enabled",
                UnavailableReason::AppleIntelligenceNotEnabled,
            ),
            ("model-not-ready", UnavailableReason::ModelNotReady),
            ("unsupported-build", UnavailableReason::UnsupportedBuild),
        ] {
            let stdout = format!("{{\"status\":\"unavailable\",\"reason\":\"{wire}\"}}");
            assert_eq!(
                parse_status(stdout.as_bytes()),
                unavailable(reason),
                "{wire}"
            );
        }
    }

    #[test]
    fn parse_status_treats_new_reasons_and_garbage_as_unknown() {
        assert_eq!(
            parse_status(b"{\"status\":\"unavailable\",\"reason\":\"brand-new-reason\"}"),
            unavailable(UnavailableReason::Unknown)
        );
        assert_eq!(
            parse_status(b"not json"),
            unavailable(UnavailableReason::Unknown)
        );
        assert_eq!(parse_status(b""), unavailable(UnavailableReason::Unknown));
    }

    #[test]
    fn check_os_requires_the_minimum_macos_major() {
        assert_eq!(check_os(Some(26)), Err(UnavailableReason::UnsupportedOs));
        assert_eq!(check_os(None), Err(UnavailableReason::UnsupportedOs));
        assert_eq!(check_os(Some(MIN_MACOS_MAJOR)), Ok(()));
        assert_eq!(check_os(Some(MIN_MACOS_MAJOR + 1)), Ok(()));
    }

    #[cfg(not(target_os = "macos"))]
    #[tokio::test]
    async fn status_is_unsupported_off_macos() {
        assert_eq!(
            status().await,
            unavailable(UnavailableReason::UnsupportedPlatform)
        );
        assert!(generate("instructions", "prompt").await.is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_running_macos_major_version() {
        let major = macos_major_version().expect("macOS version");
        assert!(major >= 10, "unexpected macOS major version {major}");
    }

    /// Drives the process plumbing with `/bin/sh` scripts standing in for
    /// the Swift sidecar.
    #[cfg(unix)]
    mod sidecar {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use tempfile::TempDir;

        fn fake_helper(dir: &TempDir, script: &str) -> PathBuf {
            let path = dir.path().join(HELPER_NAME);
            std::fs::write(&path, format!("#!/bin/sh\n{script}\n")).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            path
        }

        #[tokio::test]
        async fn status_reports_what_the_sidecar_says() {
            let dir = TempDir::new().unwrap();
            let helper = fake_helper(
                &dir,
                r#"[ "$1" = status ] && printf '{"status":"unavailable","reason":"model-not-ready"}'"#,
            );

            assert_eq!(
                status_with(&helper, Some(MIN_MACOS_MAJOR)).await,
                unavailable(UnavailableReason::ModelNotReady)
            );
        }

        #[tokio::test]
        async fn status_never_launches_the_sidecar_on_older_macos() {
            let dir = TempDir::new().unwrap();
            let marker = dir.path().join("launched");
            let helper = fake_helper(
                &dir,
                &format!(
                    "touch '{}'; printf '{{\"status\":\"available\"}}'",
                    marker.display()
                ),
            );

            assert_eq!(
                status_with(&helper, Some(MIN_MACOS_MAJOR - 1)).await,
                unavailable(UnavailableReason::UnsupportedOs)
            );
            assert!(
                !marker.exists(),
                "sidecar must not run below macOS {MIN_MACOS_MAJOR}"
            );
        }

        #[tokio::test]
        async fn status_is_unknown_when_the_sidecar_is_missing() {
            let dir = TempDir::new().unwrap();

            assert_eq!(
                status_with(&dir.path().join(HELPER_NAME), Some(MIN_MACOS_MAJOR)).await,
                unavailable(UnavailableReason::Unknown)
            );
        }

        #[tokio::test]
        async fn generate_sends_the_request_on_stdin_and_returns_the_text() {
            let dir = TempDir::new().unwrap();
            let request = dir.path().join("request.json");
            let helper = fake_helper(
                &dir,
                &format!(
                    "[ \"$1\" = generate ] || exit 9\ncat > '{}'\nprintf '{{\"text\":\"Hello, world.\"}}'",
                    request.display()
                ),
            );

            let text = generate_with(
                &helper,
                Some(MIN_MACOS_MAJOR),
                "Remove fillers.",
                "um hello \"world\"",
                GENERATE_TIMEOUT,
            )
            .await;

            assert_eq!(text, Ok("Hello, world.".to_string()));
            let sent: serde_json::Value =
                serde_json::from_slice(&std::fs::read(&request).unwrap()).unwrap();
            assert_eq!(
                sent,
                json!({ "instructions": "Remove fillers.", "prompt": "um hello \"world\"" })
            );
        }

        #[tokio::test]
        async fn generate_surfaces_sidecar_errors() {
            let dir = TempDir::new().unwrap();
            let helper = fake_helper(
                &dir,
                r#"cat > /dev/null; printf '{"error":"guardrail violation"}'; exit 1"#,
            );

            let err = generate_with(&helper, Some(MIN_MACOS_MAJOR), "i", "p", GENERATE_TIMEOUT)
                .await
                .unwrap_err();

            assert!(err.contains("guardrail violation"), "{err}");
        }

        #[tokio::test]
        async fn generate_reports_a_crashing_sidecar() {
            let dir = TempDir::new().unwrap();
            let helper = fake_helper(&dir, "cat > /dev/null; echo 'dyld: boom' >&2; exit 134");

            let err = generate_with(&helper, Some(MIN_MACOS_MAJOR), "i", "p", GENERATE_TIMEOUT)
                .await
                .unwrap_err();

            assert!(err.contains("dyld: boom"), "{err}");
        }

        #[tokio::test]
        async fn generate_gives_up_on_a_hung_sidecar() {
            let dir = TempDir::new().unwrap();
            let helper = fake_helper(&dir, "exec sleep 30");
            let started = std::time::Instant::now();

            let err = generate_with(
                &helper,
                Some(MIN_MACOS_MAJOR),
                "i",
                "p",
                Duration::from_millis(200),
            )
            .await
            .unwrap_err();

            assert!(err.contains("did not respond"), "{err}");
            assert!(started.elapsed() < Duration::from_secs(5));
        }

        #[tokio::test]
        async fn generate_refuses_older_macos_without_launching_the_sidecar() {
            let dir = TempDir::new().unwrap();
            let marker = dir.path().join("launched");
            let helper = fake_helper(&dir, &format!("touch '{}'", marker.display()));

            let err = generate_with(
                &helper,
                Some(MIN_MACOS_MAJOR - 1),
                "i",
                "p",
                GENERATE_TIMEOUT,
            )
            .await
            .unwrap_err();

            assert!(err.contains(&format!("macOS {MIN_MACOS_MAJOR}")), "{err}");
            assert!(!marker.exists());
        }
    }

    /// End-to-end check against the real sidecar that `build.rs` compiled.
    /// Needs macOS 27+ with Apple Intelligence turned on:
    /// `cargo test --lib apple_intelligence -- --ignored`
    #[cfg(target_os = "macos")]
    #[tokio::test]
    #[ignore = "needs macOS 27+ with Apple Intelligence enabled"]
    async fn real_sidecar_cleans_up_a_transcript() {
        let helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(format!("{HELPER_NAME}-{}", env!("TAURI_ENV_TARGET_TRIPLE")));
        let os = macos_major_version();
        assert_eq!(
            status_with(&helper, os).await,
            AppleIntelligenceStatus::Available
        );

        let text = generate_with(
            &helper,
            os,
            "Remove filler words such as um and uh. Reply with only the edited text.",
            "um so uh the build is green",
            GENERATE_TIMEOUT,
        )
        .await
        .expect("on-device generation");

        let lower = text.to_lowercase();
        assert!(lower.contains("build is green"), "{text}");
        assert!(!lower.contains("um ") && !lower.contains("uh "), "{text}");
    }
}
