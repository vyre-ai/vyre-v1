# gate.rule_changed

A Gate rule changed (Space default, owner floor or per-agent override)

| | |
|---|---|
| Module | gate |
| Schema version | 1 |
| Subject | entity at /act |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  act: "send" | "post" | "pay" | "delete" | "push_protected" | "campaign_launch" | "secret_export" | "site_promote" | "signature_send" | "spend_raise";
  scope: "space" | "floor" | "agent";
  agentId?: string;
  by: string;
};
```
