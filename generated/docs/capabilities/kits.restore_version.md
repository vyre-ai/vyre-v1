# kits.restore_version

Restore an earlier Kit version

| | |
|---|---|
| Module | kits |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | kits.publish |
| Grant level | edit |
| Risk | medium |
| Resource | kit (/kitId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/kits/restore_version |
| MCP tool | kits_restore_version (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  kitId: string;
  versionId: string;
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
    "kitId": "kit_a1b2c3",
    "versionId": "ver_a1b2c3"
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
