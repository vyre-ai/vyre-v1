# schema.label_changed

The sensitivity label of a type or field changed

| | |
|---|---|
| Module | schema |
| Schema version | 1 |
| Subject | record_type at /type |
| Visibility | space |
| Label | none |
| Replay | pure |
| Automation trigger | no |
| Notification | none |
| Retention | default |

## Payload

```ts
type Payload = {
  type: string;
  field?: string;
  from: "public" | "internal" | "confidential" | "restricted";
  to: "public" | "internal" | "confidential" | "restricted";
};
```
