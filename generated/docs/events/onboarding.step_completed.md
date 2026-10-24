# onboarding.step_completed

A first-run checklist step was done

| | |
|---|---|
| Module | spaces |
| Schema version | 1 |
| Subject | entity at /person |
| Visibility | owner |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  person: string;
  step: "photo_title" | "connect_mailbox" | "meet_assistant" | "first_project" | "import";
};
```
