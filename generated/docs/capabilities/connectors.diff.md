# connectors.diff

Diff a draft against the live version of a connector

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
| HTTP | POST /v1/connectors/diff |
| MCP tool | connectors_diff (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  key: string;
  draftId?: string;
};
```

## Output

```ts
type Out = {
  files: Array<{
      path: string;
      added: number;
      removed: number;
    }>;
  breaking: boolean;
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
    "draftId": "cdr_a1b2c3",
    "key": "hubspot"
  },
  "output": {
    "breaking": true,
    "files": [
      {
        "added": 1,
        "path": "example",
        "removed": 1
      }
    ]
  }
}
```
