# kits.install

Install a Kit after the sheet is confirmed

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.install |
| Grant level | manage |
| Risk | high |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/kits/install |
| MCP tool | kits_install (sites) |
| CLI | none |
| Emits | kit.installed |

## Input

```ts
type In = {
  kitId: string;
  accepted: true;
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
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "accepted": true,
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
