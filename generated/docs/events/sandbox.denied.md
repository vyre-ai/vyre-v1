# sandbox.denied

A Kit script or connector call was denied in the sandbox

| | |
|---|---|
| Module | kits |
| Schema version | 1 |
| Subject | kit at /kitId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | health.degraded |
| Retention | default |

## Payload

```ts
type Payload = {
  kitId: string;
  what: string;
  traceId: string;
};
```
