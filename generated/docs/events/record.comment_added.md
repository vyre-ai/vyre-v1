# record.comment_added

A comment or reply was left on a record; mentions names the people and agents it calls on

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /recordId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  recordId: string;
  type: string;
  commentId: string;
  parentId?: string;
  mentions: Array<{
      kind: "person" | "agent";
      id: string;
    }>;
};
```
