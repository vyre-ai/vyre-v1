# spend.raised

A limit was raised

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /scope |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  scope: string;
  scopeId?: string;
  limit: string;
  mode: string;
  by: string;
};
```
