# settings.changed

A setting changed (settings hold no secrets)

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
| Retention | default |

## Payload

```ts
type Payload = {
  key: string;
  scope: "space" | "person";
  person?: string;
  before: unknown;
  after: unknown;
  by: string;
};
```
