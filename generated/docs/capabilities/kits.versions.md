# kits.versions

List Kit versions (One History)

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
| HTTP | POST /v1/kits/versions |
| MCP tool | kits_versions (sites) |
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
  versions: Array<{
      versionId: string;
      version: string;
      at: number;
      by: string;
      channel: "stable" | "beta";
    }>;
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
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "channel": "stable",
        "version": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
