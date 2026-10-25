# site.table_created

A site table (site-scoped record type) was created; fields carries its columns so the record type can be made from the event alone

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
  type: string;
  fields?: Array<{
      key: string;
      type: string;
      title: string;
    }>;
};
```
