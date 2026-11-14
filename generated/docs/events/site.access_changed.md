# site.access_changed

Who may reach a site was changed (public, password, the Space, or private)

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
  access: "public" | "password" | "space" | "private";
};
```
