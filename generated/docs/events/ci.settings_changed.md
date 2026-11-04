# ci.settings_changed

An admin changed the CI settings (never the key)

| | |
|---|---|
| Module | ci |
| Schema version | 1 |
| Subject | entity at /enabled |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  fields: Array<string>;
  enabled: boolean;
};
```
