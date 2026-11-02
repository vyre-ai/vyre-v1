# site.published

A site or artifact went live at its address

| | |
|---|---|
| Module | sites |
| Schema version | 1 |
| Subject | site at /siteId |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  siteId: string;
  url?: string;
  access: "public" | "password" | "space" | "private";
};
```
