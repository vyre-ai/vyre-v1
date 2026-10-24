# kits.list

List Kits with channel and install state

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/list |
| MCP tool | kits_list (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  kits: Array<{
      kitId: string;
      key: string;
      title: string;
      version: string;
      channel: "stable" | "beta";
      installed: boolean;
      contents: Array<"ui" | "structure" | "steps" | "tools">;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "kits": [
      {
        "channel": "stable",
        "contents": [
          "ui"
        ],
        "installed": true,
        "key": "example",
        "kitId": "kit_a1b2c3",
        "title": "example",
        "version": "example"
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
