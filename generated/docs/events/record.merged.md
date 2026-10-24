# record.merged

Two records were merged into a survivor

| | |
|---|---|
| Module | records |
| Schema version | 1 |
| Subject | record at /survivorId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  survivorId: string;
  mergedId: string;
  type: string;
};
```
