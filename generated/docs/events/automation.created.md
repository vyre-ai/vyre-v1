# automation.created

An Automation was created (Personal)

| | |
|---|---|
| Module | automations |
| Schema version | 1 |
| Subject | automation at /automationId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  automationId: string;
  name: string;
  kind: "personal" | "space";
};
```
