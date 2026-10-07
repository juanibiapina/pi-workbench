# Changelog

All notable changes to `@juanibiapina/pi-plans` are recorded here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- Keep plan approval and comment submission visible while scrolling on desktop and mobile.
- Show approval and comment results next to the plan buttons at any scroll position, and mark the plan approved after sending.
- Flag hand-built work that a plan states as a decision or rejected alternative, and flag fewer lines that reject hand-built options or adopt an existing tool.
- Show the Jev review result on every saved plan, including no findings and the reason a review failed.

### Added

- Review saved plans with Jev when `TYPESAFE_API_KEY` is set, flagging lines that rebuild existing tools or add avoidable parts.
- Approve a plan from the browser with an editable message to Pi.
- Open saved plan links in a browser and send comments on selected text to Pi.

### Changed

- Run instructions use the server included in the Pi extension installation.
- Show one-line plan calls; expand a saved plan to open its file or see its ID.

## [0.1.1] - 2026-09-27

### Added

- Save editable plans with a Pi session.
