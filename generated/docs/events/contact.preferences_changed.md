# contact.preferences_changed

Consent, Do-not-contact or channel opt-outs changed

| | |
|---|---|
| Module | contacts-link |
| Schema version | 1 |
| Subject | record at /contactId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | A contact's preferences change |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  contactId: string;
  changed: Array<string>;
  source: string;
};
```
