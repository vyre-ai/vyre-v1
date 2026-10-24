# network.certificate_failed

Certificate issue or renewal failed

| | |
|---|---|
| Module | network |
| Schema version | 1 |
| Subject | entity at /host |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | health.degraded |
| Retention | default |

## Payload

```ts
type Payload = {
  host: string;
  reason: string;
};
```
