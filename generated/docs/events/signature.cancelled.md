# signature.cancelled

The sender cancelled an envelope; every link stopped working

| | |
|---|---|
| Module | esign |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A signature request is cancelled |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  envelopeId: string;
  recordId?: string;
};
```
