# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-06-23

First public release.

### Added

- Chat-first interface with streaming responses, markdown rendering, and syntax
  highlighting.
- Unified model selection (loaded model, searchable available models, inline
  download progress) shared across the chat bar and welcome screen.
- Two inference engines behind a common interface: WebLLM (WebGPU) and Wllama
  (GGUF/CPU, experimental).
- Vision support for capable models (image attachments sent as image parts).
- File attachments with text/PDF extraction and a 32 KB persistence cap.
- Advanced generation parameters (temperature, top-p, top-k, seed, stop
  sequences, penalties), per-conversation and as global defaults.
- Edit & regenerate messages, context-window meter, and tokens/sec stats.
- Conversation import/export as a versioned, self-contained envelope.
- Voice: read-aloud (TTS) and voice input (browser speech recognition).
- First-download onboarding: expectations dialog, WebGPU pre-check, download ETA,
  and friendly load-error recovery.
- Model browser with filters (quantization, max RAM, vision-only), device-aware
  recommendations, and cache management.

[Unreleased]: https://github.com/emre-bas/web-llm-studio/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/emre-bas/web-llm-studio/releases/tag/v0.2.0
