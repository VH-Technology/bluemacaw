#![cfg(target_os = "windows")]

use tauri::{Runtime, WebviewWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
};

pub fn make_overlay_nonactivating<R: Runtime>(
    window: &WebviewWindow<R>,
) -> tauri::Result<()> {
    let hwnd = window.hwnd()?;

    unsafe {
        let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let new_ex_style = ex_style | (WS_EX_NOACTIVATE.0 as isize);
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex_style);
    }

    log::info!("overlay_win: overlay marked as non-activating");
    Ok(())
}
