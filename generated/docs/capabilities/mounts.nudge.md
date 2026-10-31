# mounts.nudge

A provider push notice (Drive channel, Graph subscription) or an app showing a mount asks for a sync pass (system)

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/nudge |
| MCP tool | mounts_nudge (files) |
| CLI | none |
| Emits | mount.synced, mount.failed |

## Input

```ts
type In = {
  source: "google" | "microsoft" | "client";
  channelId?: string;
  subscriptionId?: string;
  replacedBy?: string;
  mountId?: string;
};
```

## Output

```ts
type Out = {
  mounts: number;
  passes: number;
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
    "channelId": "example",
    "mountId": "mnt_a1b2c3",
    "replacedBy": "example",
    "source": "google",
    "subscriptionId": "example"
  },
  "output": {
    "mounts": 1,
    "passes": 1
  }
}
```
