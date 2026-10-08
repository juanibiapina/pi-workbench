# Changelog

All notable changes to `@juanibiapina/pi-github` are recorded here. This file follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Track builds of pushed commits and their pull requests automatically.
- Show failed builds of pushed commits in the transcript and tell the agent about them, starting a turn when the agent is idle.

### Changed

- Show the branch of pull requests saved with `save_pr`.
- Stop tracking the branch's build when `remove_pr` removes its pull request.
- Show one-line pull request calls with clickable links; expand a row to see its full URL.

## [0.1.1] - 2026-09-27

### Added

- Keep GitHub pull request links with a Pi session.
