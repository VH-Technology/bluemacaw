# Ada

A macOS desktop app that provides global speech-to-text. Press a global shortcut to record audio, which is transcribed via OpenAI Whisper API and pasted into the active application.

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Create `config.json` in the project root:
   ```json
   {
     "openai_api_key": "sk-...",
     "model": "whisper-1"
   }
   ```

## Development

Run the app directly with Electron (inherits terminal permissions, no signing needed):
```
npm start
```

## Build & Install

### 1. Build the DMG

```
npm run build
```

This produces `dist/mac-arm64/Ada.app` (and a DMG in `dist/`).

### 2. Install to Applications

```
rm -rf /Applications/Ada.app
cp -R dist/mac-arm64/Ada.app /Applications/Ada.app
```

### 3. Re-sign with entitlements

electron-builder uses ad-hoc signing, but the nested binaries need to be re-signed together with the entitlements for microphone access to work:

```
codesign --force --deep --sign - --entitlements entitlements.plist /Applications/Ada.app
```

### 4. Reset permissions (if needed)

If macOS previously denied or cached permissions for Ada, reset them:

```
tccutil reset Microphone com.programow.ada
```

Then launch Ada — macOS should prompt for microphone access.

## Usage

- **Ctrl+Shift+Space** — Toggle recording
- The app lives in the system tray. Right-click the dock icon to quit.

## Platform

macOS-only. Requires Accessibility and Microphone permissions.
