# files.versions_purge

Remove file versions older than a time except the newest of each file and any named version; files listed in skipFileIds (held ones) are left whole (retention)

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | policy.manage |
| Grant level | manage |
| Risk | high |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/versions_purge |
| MCP tool | none |
| CLI | none |
| Emits | file_versions.purged |

## Input

```ts
type In = {
  before: number;
  limit?: number;
  skipFileIds?: Array<string>;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  removed: number;
  more: boolean;
  skippedOnHold?: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "before": 1760000000000,
    "idempotencyKey": "idem_1",
    "limit": 1,
    "skipFileIds": [
      "fil_a1b2c3"
    ]
  },
  "output": {
    "more": true,
    "removed": 1,
    "skippedOnHold": 1
  }
}
```
