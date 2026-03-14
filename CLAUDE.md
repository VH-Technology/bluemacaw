# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Ada

Ada is a macOS desktop app (Electron) that provides global speech-to-text. Press a global shortcut to record audio, which is transcribed via OpenAI Whisper API and pasted into the active application.

## Commands

- **Dev:** `npm start` (runs `electron .`)
- **Build:** `npm run build` (produces macOS DMG via electron-builder)
- No test or lint scripts are configured.

## Architecture

Electron multi-process model with three layers:

- **main.js** — Main process: app lifecycle, system tray, global shortcut (Ctrl+Shift+Space), OpenAI Whisper API calls, clipboard/paste via `pbcopy` + CGEvent
- **renderer.js** — Renderer process: microphone capture via MediaRecorder (WebM), sends audio buffers to main via IPC
- **preload.js** — IPC bridge with context isolation: exposes `window.ada.onToggleRecording()` and `window.ada.transcribe()`
- **index.html** — Minimal UI showing recording/processing status

**User flow:** Shortcut toggles recording → renderer captures audio → sends to main → main calls Whisper API → copies result to clipboard → simulates Cmd+V paste into active app.

## Platform

macOS-only. Uses native APIs: `pbcopy`, `osascript`, CGEvent keystroke simulation. A `paste-helper.swift` exists as a compiled Swift binary for clipboard/paste operations.

## Configuration

`config.json` holds the OpenAI API key and model (`whisper-1`). This file contains secrets — never commit it.
