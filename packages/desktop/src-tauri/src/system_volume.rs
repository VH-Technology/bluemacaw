//! Best-effort system **output** volume control for the "duck while
//! recording" feature.
//!
//! Every function is best-effort: on any failure (no audio device, a missing
//! CLI tool, a COM error) it logs and no-ops. Volume control must never break
//! a recording — if we can't read or set the volume we simply don't duck.
//!
//! Per platform:
//! - macOS: `osascript` (AppleScript `output volume`, 0..100).
//! - Linux: `pactl` against `@DEFAULT_SINK@` (PulseAudio / PipeWire-pulse).
//! - Windows: `IAudioEndpointVolume` (Core Audio) via the `windows` crate.

/// Read the current system output volume as 0.0..=1.0, or `None` if it can't
/// be determined.
pub fn get_output_volume() -> Option<f32> {
    platform::get()
}

/// Set the system output volume. `level` is clamped to 0.0..=1.0. Best-effort.
pub fn set_output_volume(level: f32) {
    platform::set(level.clamp(0.0, 1.0));
}

#[cfg(target_os = "macos")]
mod platform {
    use std::process::Command;

    pub fn get() -> Option<f32> {
        let out = Command::new("osascript")
            .args(["-e", "output volume of (get volume settings)"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let pct: f32 = String::from_utf8_lossy(&out.stdout).trim().parse().ok()?;
        Some((pct / 100.0).clamp(0.0, 1.0))
    }

    pub fn set(level: f32) {
        let pct = (level * 100.0).round() as i64;
        if let Err(e) = Command::new("osascript")
            .args(["-e", &format!("set volume output volume {pct}")])
            .status()
        {
            log::warn!("system_volume: osascript set failed: {e}");
        }
    }
}

#[cfg(target_os = "linux")]
mod platform {
    use std::process::Command;

    pub fn get() -> Option<f32> {
        let out = Command::new("pactl")
            .args(["get-sink-volume", "@DEFAULT_SINK@"])
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        // Output looks like: "Volume: front-left: 32768 /  50% / ... "
        // Grab the first "NN%" token.
        let s = String::from_utf8_lossy(&out.stdout);
        for tok in s.split_whitespace() {
            if let Some(num) = tok.strip_suffix('%') {
                if let Ok(pct) = num.parse::<f32>() {
                    return Some((pct / 100.0).clamp(0.0, 1.0));
                }
            }
        }
        None
    }

    pub fn set(level: f32) {
        let pct = (level * 100.0).round() as i64;
        if let Err(e) = Command::new("pactl")
            .args(["set-sink-volume", "@DEFAULT_SINK@", &format!("{pct}%")])
            .status()
        {
            log::warn!("system_volume: pactl set failed: {e}");
        }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    /// Resolve the default render device's volume control. COM is initialized
    /// per call (idempotent on a thread that's already initialized).
    fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
        unsafe {
            // Ignore the HRESULT: S_FALSE means COM was already initialized on
            // this thread, RPC_E_CHANGED_MODE means a different mode is active
            // — both are fine for our read/set calls.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let volume: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            Ok(volume)
        }
    }

    pub fn get() -> Option<f32> {
        let volume = match endpoint() {
            Ok(v) => v,
            Err(e) => {
                log::warn!("system_volume: endpoint() failed: {e}");
                return None;
            }
        };
        match unsafe { volume.GetMasterVolumeLevelScalar() } {
            Ok(level) => Some(level.clamp(0.0, 1.0)),
            Err(e) => {
                log::warn!("system_volume: GetMasterVolumeLevelScalar failed: {e}");
                None
            }
        }
    }

    pub fn set(level: f32) {
        match endpoint() {
            Ok(volume) => unsafe {
                if let Err(e) = volume.SetMasterVolumeLevelScalar(level, std::ptr::null()) {
                    log::warn!("system_volume: SetMasterVolumeLevelScalar failed: {e}");
                }
            },
            Err(e) => log::warn!("system_volume: endpoint() failed: {e}"),
        }
    }
}
