# automation.group_deleted

A Group was deleted; its Automations became ungrouped

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | entity at /groupId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  groupId: string;
};
```
