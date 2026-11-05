# gate.denied

A gated act was sent back or dropped

| | |
|---|---|
| Module | gate |
| Schema version | 1 |
| Subject | task at /taskId |
| Visibility | participants |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  holdId: string;
  act: "send" | "post" | "pay" | "delete" | "transfer" | "enroll_node" | "connection_change" | "push_protected" | "secret_export" | "site_promote" | "signature_send" | "spend_raise" | "signin_change" | "install" | "approve" | "github_approval";
  taskId: string;
  by: string;
  mode: "send_back" | "drop";
  note?: string;
  askedBy?: {
    kind: "person" | "agent" | "actor" | "service";
    id: string;
  };
  capName?: string;
  threadId?: string;
  agentId?: string;
  actingFor?: string;
};
```
