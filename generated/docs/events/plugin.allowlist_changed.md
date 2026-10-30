# plugin.allowlist_changed

The plugin allowlist changed

| | |
|---|---|
| Module | agents |
| Schema version | 1 |
| Subject | entity at /marketplace |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  kind: "marketplace" | "plugin";
  marketplace: string;
  plugin?: string;
  allowed: boolean;
  by: string;
};
```
