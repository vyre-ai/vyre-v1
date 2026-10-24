# member.removal_plan_applied

The removal wizard reassigned or paused the things the person owned (counts only)

| | |
|---|---|
| Module | members |
| Schema version | 1 |
| Subject | entity at /personId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | audit |

## Payload

```ts
type Payload = {
  personId: string;
  kinds: Array<{
      kind: "routines" | "automations" | "agents" | "records" | "files" | "channels" | "projects" | "mailbox_connections" | "vault_mine" | "private_chats" | "memory_from_you";
      action: "pause" | "reassign" | "revoke" | "export" | "retain" | "keep" | "delete";
      count: number;
    }>;
};
```
