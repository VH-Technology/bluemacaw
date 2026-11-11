# bluemacaw

[![GitHub release downloads](https://img.shields.io/github/downloads/VH-Technology/bluemacaw/total?label=downloads&color=2ea44f)](https://github.com/VH-Technology/bluemacaw/releases)
[![Latest release](https://img.shields.io/github/v/release/VH-Technology/bluemacaw?label=release)](https://github.com/VH-Technology/bluemacaw/releases/latest)

Cross-platform speech-to-text desktop app. Press a global shortcut, dictate, get text pasted wherever your cursor is. Bring your own API key for any of 10 STT providers (OpenAI, Groq, Grok (xAI), Deepgram, AssemblyAI, ElevenLabs, Fal, Gladia, Azure OpenAI, Rev.ai), or transcribe on-device with a local Whisper model.

**Status:** the Tauri-based app lives under `packages/desktop/` (see Plan B).

## Install

- **macOS:** [Download DMG](https://bluemacaw.com) (signed + notarized), or [with Homebrew](#install-with-homebrew-macos).
- **Windows:** [Download installer](https://bluemacaw.com) (unsigned at v1; SmartScreen warning expected)

### Install with Homebrew (macOS)

bluemacaw ships from our own tap, `vh-technology/tap`, not from Homebrew's official taps. Homebrew does not trust third-party taps by default, because a tap is code that runs on your machine with your user's privileges. You have to trust it yourself.

> [!IMPORTANT]
> **Trust the cask only after you have audited it yourself.** Do not trust it because this README says so. Read the cask first, and the app source in this repo if you want to go further. If anything looks wrong, stop and do not run the trust or install commands.

1. **Add the tap.** This only downloads it; Homebrew will not load anything from it until you trust it.

   ```sh
   brew tap vh-technology/tap
   ```

2. **Audit the cask.** It is one short file, also viewable [on GitHub](https://github.com/VH-Technology/homebrew-tap/blob/main/Casks/bluemacaw.rb).

   ```sh
   cat "$(brew --repository vh-technology/tap)/Casks/bluemacaw.rb"
   ```

   Check that the `url` points at a release of this repository (`github.com/VH-Technology/bluemacaw/releases`), that a `sha256` is pinned, and that the file only installs `bluemacaw.app` with no extra scripts.

3. **Trust the cask — only once step 2 satisfied you.**

   ```sh
   brew trust --cask vh-technology/tap/bluemacaw
   ```

   This trusts the bluemacaw cask and nothing else. `brew trust vh-technology/tap` would trust the whole tap, including anything added to it later, so prefer the cask-only form.

4. **Install.**

   ```sh
   brew install --cask bluemacaw
   ```

**One-line shortcut.** `brew install --cask vh-technology/tap/bluemacaw` does steps 1, 3 and 4 at once: installing by the full name makes Homebrew trust the cask for you. Run it only after auditing the cask on GitHub.

To withdraw trust later, run `brew untrust --cask vh-technology/tap/bluemacaw`.

## Why bluemacaw

- **Bring your own key.** Your API keys live in your OS keychain. Audio goes only to the STT provider you chose; optional transcript cleanup goes directly to OpenAI only when enabled, or stays on-device with Apple Intelligence on macOS 27+. No bluemacaw backend.
- **Multi-provider.** Pick the model that fits: OpenAI Whisper, Groq's distil-whisper, Deepgram Nova, AssemblyAI, ElevenLabs Scribe, and more.
- **Cross-platform.** macOS, Windows. Same shortcut. Same UX.
- **Open source (Apache 2.0).** Read the code. Verify the privacy story.

## Project layout

```
bluemacaw/
├── packages/
│   ├── desktop/      # Tauri app — see Plan B
│   └── landing/      # Next.js landing page — see Plan C
├── docs/             # Architecture, testing, permissions, secrets, build/release
└── .claude/commands/ # Slash commands for AI-assisted development
```

## Documentation

- [`docs/`](./docs) — architecture, testing, permissions, secrets, CI/CD, troubleshooting
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how to contribute, branching model, conventional commits
- [`CLAUDE.md`](./CLAUDE.md) — AI dev workflow guide

## License

Apache 2.0. See [`LICENSE`](./LICENSE).
