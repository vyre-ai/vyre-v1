# kits.get

Read one Kit

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/get |
| MCP tool | kits_get (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
};
```

## Output

```ts
type Out = {
  kit: {
    kitId: string;
    key: string;
    title: string;
    version: string;
    channel: "stable" | "beta";
    installed: boolean;
    contents: Array<"ui" | "structure" | "steps" | "tools">;
  };
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "kitId": "kit_a1b2c3"
  },
  "output": {
    "kit": {
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
  }
}
```
