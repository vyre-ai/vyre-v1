# google.dwd_probed

A delegation probe ran

| | |
|---|---|
| Module | google |
| Schema version | 1 |
| Subject | connector at /connector |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  connector: "google";
  ok: boolean;
  email?: string;
  scopesMissing: Array<string>;
};
```
