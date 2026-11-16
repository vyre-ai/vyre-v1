# esign.verify

Is this file sealed, unchanged since, and sealed by this Space

| | |
|---|---|
| Module | esign |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/esign/verify |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  sealed: boolean;
  intact: boolean;
  signedAt?: number;
  fingerprint?: string;
  bySpace: boolean;
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "bySpace": true,
    "fingerprint": "example",
    "intact": true,
    "sealed": true,
    "signedAt": 1760000000000
  }
}
```
