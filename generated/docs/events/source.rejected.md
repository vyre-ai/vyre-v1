# source.rejected

A delivery failed verification (signature or secret) and was refused

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /source |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId?: string;
  source: string;
  reason: "bad_signature" | "unknown_source" | "paused" | "too_large" | "bad_payload";
};
```
