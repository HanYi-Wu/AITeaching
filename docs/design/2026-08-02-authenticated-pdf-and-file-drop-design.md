# Authenticated PDF Preview and Teacher File Drop Design

## Goal

Fix protected PDF previews in public mode and let a teacher add files to the AI assistant by dragging them anywhere over the assistant panel.

## Existing behavior and root cause

`PdfPreview` resolves an API URL and passes the URL string directly to `react-pdf`. In public mode, PDF routes require the platform bearer token, but PDF.js performs its own request without the token. The same preview URL therefore returns 401 without the header and 200 with it.

The assistant already supports attachment selection and upload, but its drop handler is limited to the text area. It has no panel-wide drop target or visible drag state, and the send path refuses file-only requests.

## Design

### Authenticated PDF loading

Add an authenticated blob-fetch helper to the existing API client. `PdfPreview` will fetch the protected PDF through that helper, create an object URL for PDF.js, and revoke the URL whenever the path changes or the component unmounts. This keeps authentication in the existing request layer and avoids exposing bearer tokens through PDF.js configuration.

### Teacher file drop

Use the existing `AgentChatPanel` as the single teacher file entry point because it is available across teacher workspaces and already owns session creation, uploads, supported-format rules, attachment chips, and AI dispatch.

The whole panel becomes a drop target. During a file drag it displays a clear overlay. Dropped files are added to the same pending attachment list used by the paperclip button. Repeated browser drag events are depth-counted so the overlay does not flicker while crossing child elements.

File-only submission is allowed. When no text is present, the client supplies a localized default request asking the AI to read and process the attached files. Empty submissions without files remain blocked. Unsupported formats continue to be rejected by the server and rendered with the existing actionable conversion/OCR guidance.

## Error handling and accessibility

- Authenticated PDF fetch failures are shown through the existing PDF error state.
- Object URLs are always revoked to prevent browser memory leaks.
- The drop overlay is visual only; the paperclip button remains the keyboard-accessible equivalent.
- Dropped items with no actual files are ignored.

## Verification

- API-client regression test proves the bearer token is attached to PDF blob requests.
- PDF component test proves object-URL creation and cleanup.
- Assistant component/helper tests prove panel-level drop state, file queuing, and file-only default prompts.
- Browser verification covers teacher login, protected PDF rendering, and a real file drop into the assistant.

