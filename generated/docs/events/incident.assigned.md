# incident.assigned

An AI incident was assigned

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
  ownerId: string;
};
```
