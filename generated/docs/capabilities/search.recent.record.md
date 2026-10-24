# search.recent.record

Note that the caller opened something so it shows under Recent

| | |
|---|---|
| Module | search |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | none |
| Offline | queue |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/search/recent/record |
| MCP tool | search_recent_record (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kind: "person" | "agent" | "chat" | "inbox" | "record" | "file" | "automation" | "app" | "setting" | "memory" | "task" | "channel";
  itemId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "itemId": "example",
    "kind": "person"
  },
  "output": {
    "ok": true
  }
}
```
