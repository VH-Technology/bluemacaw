import Cocoa

// Read text from stdin
let data = FileHandle.standardInput.readDataToEndOfFile()
guard let text = String(data: data, encoding: .utf8), !text.isEmpty else {
    exit(1)
}

// Set clipboard via NSPasteboard
let pasteboard = NSPasteboard.general
pasteboard.clearContents()
pasteboard.setString(text, forType: .string)

// Wait for clipboard to be ready
usleep(100_000) // 0.1 seconds

// Simulate Cmd+V via CGEvent
let keyDown = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true)!
let keyUp = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false)!
keyDown.flags = .maskCommand
keyUp.flags = .maskCommand
keyDown.post(tap: .cghidEventTap)
keyUp.post(tap: .cghidEventTap)
