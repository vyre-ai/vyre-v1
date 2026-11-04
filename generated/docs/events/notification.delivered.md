# notification.delivered

A notification was delivered to a person at its level

| | |
|---|---|
| Module | notifications |
| Schema version | 1 |
| Subject | entity at /notificationId |
| Visibility | owner |
| Label | none |
| Replay | stub |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  notificationId: string;
  person: string;
  kind: "approval.requested" | "answer.requested" | "unblock.requested" | "approval.backstop" | "dm" | "mention" | "call.incoming" | "agent.blocked" | "incident.owned" | "task.assigned" | "reply.followed" | "agent.task_finished" | "digest.away" | "mention.thread" | "run.failed" | "conflict.needs_you" | "access.requested" | "access.decided" | "sync.attention" | "health.degraded" | "problem.report" | "member.joined" | "limit.hit" | "vault.rotation_due" | "reply.thread" | "task.turn" | "task.returned" | "task.finished" | "task.due" | "machine.alert" | "item.shared" | "space.deletion_scheduled" | "space.deletion_cancelled" | "ci.paused";
  level: "interrupt" | "badge" | "digest";
  place: "home" | "chats" | "inbox" | "records" | "files" | "apps" | "automations" | "vault" | "settings" | "console";
  subject?: {
    type: "space" | "record_type" | "record" | "project" | "folder" | "file" | "channel" | "thread" | "inbox" | "mailbox" | "vault_folder" | "vault_item" | "automation_group" | "automation" | "agent" | "connector" | "connection" | "site" | "form" | "kit" | "terminal" | "computer" | "task" | "run" | "number" | "domain" | "calendar";
    id: string;
  };
  collapsed: boolean;
  pushed: boolean;
  device?: string;
};
```
