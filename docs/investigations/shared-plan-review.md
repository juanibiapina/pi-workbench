# Plan viewer integration notes

The browser opens individual saved-plan links and sends messages to Pi. See the [usage instructions](../../packages/pi-plans/README.md#open-and-review-a-plan).

## Integration

Pi's session context provider owns the plan index and Markdown attachments. The browser reads these files directly because the provider's `Store.readSession` method can create or migrate context files.

The existing socket supports `send_user_message` with immediate delivery when idle and followUp when busy. The browser includes `expectedSessionId`; the socket handler checks it before accepting the message. Existing socket size limits apply.

Plannotator publishes reusable viewer and annotation-panel components. The browser bundles these components with its own file lookup and message endpoint. It formats comment reviews before sending them; approval sends the editable implementation message. The server is started manually.

## Sources

Research date: 2026-10-01.

- Initial pi-workbench source: `a7bb815`.
- Pi session storage source: `86dfceec4`.
- Plannotator source: `57da5b36ff27b30bc9302a94b7c9f9db10f9f742`.
- Published UI used by the build: `@plannotator/ui` version `0.47.0`.
- [Plannotator UI documentation](https://github.com/backnotprop/plannotator/blob/main/packages/ui/README.md).
- [Pi session documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sessions.md).
