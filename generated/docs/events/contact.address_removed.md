# contact.address_removed

An email, phone or handle was removed from a contact

| | |
|---|---|
| Module | contacts-link |
| Schema version | 1 |
| Subject | record at /contactId |
| Visibility | space |
| Label | subject |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  contactId: string;
  kind: "email" | "phone" | "handle";
  addressId: string;
};
```
