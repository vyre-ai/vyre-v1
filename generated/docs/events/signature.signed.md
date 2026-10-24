# signature.signed

All signers signed; the signed PDF and audit certificate were saved as a new version

| | |
|---|---|
| Module | esign |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A document is signed |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  envelopeId: string;
  fileId: string;
};
```
