# service.restarted

A server service was restarted

| | |
|---|---|
| Module | health |
| Schema version | 1 |
| Subject | entity at /service |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  service: string;
};
```
