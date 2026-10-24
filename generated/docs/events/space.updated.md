# space.updated

The Space profile changed (name, legal name, logo, defaults)

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /by |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | The Space profile changes |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  fields: Array<string>;
  by: string;
};
```
