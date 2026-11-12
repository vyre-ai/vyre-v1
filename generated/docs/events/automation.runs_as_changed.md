# automation.runs_as_changed

The person a Space Automation runs as changed: someone turned it on, published a change, restored a version or put it on the Space; or nobody, after a change no person pressed

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
| Retention | audit |

## Payload

```ts
type Payload = {
  automationId: string;
  from: string | null;
  to: string | null;
  by: string;
  why: "on" | "save" | "restore" | "promote" | "cleared";
};
```
