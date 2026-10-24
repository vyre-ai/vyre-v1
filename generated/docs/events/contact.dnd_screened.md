# contact.dnd_screened

A Do-not-contact screening ran over new adds (never removes anyone)

| | |
|---|---|
| Module | contacts-link |
| Schema version | 1 |
| Subject | entity at /context |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  context: "audience" | "campaign" | "journey_enrol" | "import";
  contextId?: string;
  screened: number;
  refused: number;
};
```
