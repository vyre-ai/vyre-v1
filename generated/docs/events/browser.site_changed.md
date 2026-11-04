# browser.site_changed

A Browser connection was added, changed or removed

| | |
|---|---|
| Module | browser |
| Schema version | 1 |
| Subject | entity at /siteId |
| Visibility | participants |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  siteId: string;
  host: string;
  runsIn: "chrome" | "computers" | "both";
  removed: boolean;
};
```
