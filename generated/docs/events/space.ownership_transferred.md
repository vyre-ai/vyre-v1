# space.ownership_transferred

Ownership moved to another person

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /to |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  from: string;
  to: string;
};
```
