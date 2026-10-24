# audit.checkpoint

System: write a signed checkpoint of the hash chain

| | |
|---|---|
| Module | audit |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/audit/checkpoint |
| MCP tool | none |
| CLI | none |
| Emits | audit.checkpointed |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  checkpoint: {
    seq: number;
    at: number;
    hash: string;
    signatureOk: boolean;
  };
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
  "input": {},
  "output": {
    "checkpoint": {
      "at": 1760000000000,
      "hash": "example",
      "seq": 1,
      "signatureOk": true
    }
  }
}
```
