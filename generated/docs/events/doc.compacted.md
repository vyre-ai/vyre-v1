# doc.compacted

A document was compacted into a snapshot and Markdown projection

| | |
|---|---|
| Module | sync |
| Schema version | 1 |
| Subject | entity at /doc |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  doc: string;
  upto: number;
  bytes: number;
  named?: string;
};
```
