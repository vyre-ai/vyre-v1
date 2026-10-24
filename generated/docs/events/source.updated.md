# source.updated

A source mapping or setting changed

| | |
|---|---|
| Module | sources |
| Schema version | 1 |
| Subject | entity at /sourceId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  sourceId: string;
  fields: Array<string>;
};
```
