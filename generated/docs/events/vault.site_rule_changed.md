# vault.site_rule_changed

A person set or cleared the never-fill or never-save rule for one site (host only)

| | |
|---|---|
| Module | vault |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  personId: string;
  host: string;
  neverFill: boolean;
  neverSave: boolean;
};
```
