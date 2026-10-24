# inbound_route.removed

An inbound route was removed

| | |
|---|---|
| Module | mail |
| Schema version | 1 |
| Subject | domain at /domainId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  routeId: string;
  domainId: string;
};
```
