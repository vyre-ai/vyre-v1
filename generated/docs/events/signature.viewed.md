# signature.viewed

A signer opened the envelope

| | |
|---|---|
| Module | esign |
| Schema version | 1 |
| Subject | entity at /envelopeId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  envelopeId: string;
  signer: string;
};
```
