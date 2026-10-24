# connectors.versions

List published versions of a connector

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | connectors.manage |
| Grant level | view |
| Risk | low |
| Resource | connector (/key) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/versions |
| MCP tool | connectors_versions (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      version: string;
      at: number;
      by: string;
      note?: string;
      tests: number;
    }>;
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
    "key": "hubspot"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "note": "example",
        "tests": 1,
        "version": "example"
      }
    ]
  }
}
```
