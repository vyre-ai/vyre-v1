# records.versions

List versions of a record (One History)

| | |
|---|---|
| Module | records |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/records/versions |
| MCP tool | records_versions (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  type: string;
  recordId: string;
};
```

## Output

```ts
type Out = {
  versions: Array<{
      versionId: string;
      n: number;
      by: string;
      at: number;
      reason?: string;
      name?: string;
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
    "recordId": "rec_a1b2c3",
    "type": "contact"
  },
  "output": {
    "versions": [
      {
        "at": 1760000000000,
        "by": "example",
        "n": 1,
        "name": "example",
        "reason": "example",
        "versionId": "ver_a1b2c3"
      }
    ]
  }
}
```
