---
name: Electron runtime compatibility
description: Compatibility constraint observed when checking the imported desktop app in the Replit environment.
---

Electron 44 declares Node 22.12+ in its package metadata, while this project’s Replit environment uses Node 20. Dependency installation can therefore emit `EBADENGINE` warnings even when the application’s Node-based tests pass.

**Why:** The project is an Electron desktop app and cannot use the Replit browser preview, so the runtime warning should not be mistaken for a failure in the application’s comparison or rendering logic.

**How to apply:** Keep the existing Electron/Node stack unless the user explicitly requests a runtime upgrade; validate non-GUI logic with the project’s tests and validate the desktop window locally.