# signature.sent

An envelope was sent for signature

| | |
|---|---|
| Module | esign |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | stub |
| Automation trigger | A document is sent for signature |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  envelopeId: string;
  recordId?: string;
  provider: "documenso" | "dropbox_sign" | "docusign";
};
```
