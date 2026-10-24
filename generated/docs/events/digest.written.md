# digest.written

The While you were away digest was written for a person

| | |
|---|---|
| Module | home |
| Schema version | 1 |
| Subject | entity at /digestId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | digest.away |
| Retention | default |

## Payload

```ts
type Payload = {
  digestId: string;
  person: string;
  periodStart: number;
  periodEnd: number;
  items: number;
};
```
