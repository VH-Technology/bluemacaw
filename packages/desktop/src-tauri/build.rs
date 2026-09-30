use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn main() {
    // `cfg!(target_os)` would describe the build host; the target is what matters.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        build_apple_intelligence_helper();
    }
    // Must run after the helper exists: tauri-build copies `bundle.externalBin`
    // (see tauri.macos.conf.json) next to the main binary and fails if it's missing.
    tauri_build::build()
}

/// Compiles the Swift sidecar behind on-device transcript cleanup (see
/// `src/apple_intelligence/mod.rs`) to `binaries/<name>-<target-triple>`, the
/// path Tauri's `externalBin` convention expects.
fn build_apple_intelligence_helper() {
    const NAME: &str = "bluemacaw-apple-intelligence";
    const SOURCE: &str = "swift/apple-intelligence/main.swift";
    println!("cargo:rerun-if-changed={SOURCE}");
    println!("cargo:rerun-if-env-changed=BLUEMACAW_REQUIRE_FOUNDATION_MODELS");

    let sdk = xcrun(&["--sdk", "macosx", "--show-sdk-path"]);
    let has_foundation_models = Path::new(&sdk)
        .join("System/Library/Frameworks/FoundationModels.framework")
        .exists();
    if !has_foundation_models {
        let message = format!(
            "the macOS SDK at {sdk} has no FoundationModels framework (Xcode 26 or newer is required), \
             so Apple Intelligence cleanup will be unavailable in this build"
        );
        if env::var("BLUEMACAW_REQUIRE_FOUNDATION_MODELS").as_deref() == Ok("1") {
            panic!("{message}");
        }
        println!("cargo:warning={message}");
    }

    // The helper only ever runs on macOS 27+, which is Apple silicon only, so
    // an arm64 build serves arm64, x86_64 (via Rosetta) and universal bundles
    // alike. Without FoundationModels it compiles to a stub, which has no
    // reason to require a recent macOS.
    let swift_target = if has_foundation_models {
        "arm64-apple-macos26.0"
    } else {
        "arm64-apple-macos11.0"
    };
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let compiled = out_dir.join(NAME);
    let status = Command::new("xcrun")
        .args([
            "--sdk",
            "macosx",
            "swiftc",
            "-O",
            "-target",
            swift_target,
            SOURCE,
            "-o",
        ])
        .arg(&compiled)
        // tauri-cli exports the app's 10.15 deployment target; `-target`
        // already carries the helper's own.
        .env_remove("MACOSX_DEPLOYMENT_TARGET")
        .status()
        .expect("failed to run swiftc (install the Xcode Command Line Tools)");
    assert!(status.success(), "swiftc failed to compile {SOURCE}");

    let target = env::var("TARGET").expect("TARGET");
    fs::create_dir_all("binaries").expect("create binaries/");
    // tauri-build looks for the build's own triple; `tauri build --target
    // universal-apple-darwin` bundles the `universal-apple-darwin` one.
    for triple in [target.as_str(), "universal-apple-darwin"] {
        copy_if_changed(
            &compiled,
            &Path::new("binaries").join(format!("{NAME}-{triple}")),
        );
    }
}

fn xcrun(args: &[&str]) -> String {
    let output = Command::new("xcrun")
        .args(args)
        .output()
        .expect("failed to run xcrun (install the Xcode Command Line Tools)");
    assert!(output.status.success(), "xcrun {args:?} failed");
    String::from_utf8(output.stdout)
        .expect("xcrun output is UTF-8")
        .trim()
        .to_string()
}

/// tauri-build registers the sidecar as `rerun-if-changed`; rewriting an
/// identical file would bump its mtime and make every build rerun this script.
fn copy_if_changed(from: &Path, to: &Path) {
    let bytes = fs::read(from).expect("read compiled helper");
    if fs::read(to).ok().as_deref() == Some(bytes.as_slice()) {
        return;
    }
    fs::write(to, &bytes).expect("write helper binary");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(to, fs::Permissions::from_mode(0o755)).expect("chmod helper binary");
    }
}
