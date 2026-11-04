# project.link_rules_set

The rules that link matching new items to a project changed

| | |
|---|---|
| Module | projects |
| Schema version | 1 |
| Subject | project at /projectId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  projectId: string;
  rules: number;
  by: string;
};
```
