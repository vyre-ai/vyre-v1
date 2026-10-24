# doc.updated

A long text document received an accepted update (id and byte size only, never content)

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /doc |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A document is edited |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  doc: string;
  bytes: number;
  actor: string;
  seq: number;
};
```
