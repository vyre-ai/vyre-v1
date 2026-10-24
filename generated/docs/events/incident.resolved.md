# incident.resolved

An AI incident was resolved

| | |
|---|---|
| Module | engine |
| Schema version | 1 |
| Subject | entity at /incidentId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  incidentId: string;
  by: string;
};
```
