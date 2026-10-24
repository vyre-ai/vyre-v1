# incident.opened

An AI incident was opened

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /incidentId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | incident.owned |
| Retention | default |

## Payload

```ts
type Payload = {
  incidentId: string;
  kind: string;
  ownerId?: string;
};
```
