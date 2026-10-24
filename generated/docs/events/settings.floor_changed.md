# settings.floor_changed

The owner floor on a setting changed; nobody may go below it

| | |
|---|---|
| Module | settings |
| Schema version | 1 |
| Subject | entity at /key |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  key: string;
  by: string;
};
```
