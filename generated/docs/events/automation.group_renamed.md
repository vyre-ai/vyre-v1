# automation.group_renamed

A Group was renamed

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
  name: string;
};
```
