# signature.declined

A signer declined

| | |
|---|---|
| Module | esign |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | A signature is declined |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  envelopeId: string;
  signer: string;
  reason?: string;
};
```
