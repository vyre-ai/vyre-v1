# gate.taint.mark

System: outside words entered the turn in these threads, and the links a page gave are now known. Only the server may call it

| | |
|---|---|
| Module | gate |
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
| HTTP | POST /v1/gate/taint/mark |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threads: Array<string>;
  source: string;
  links?: Array<string>;
};
```

## Output

```ts
type Out = {
  ok: boolean;
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
    "links": [
      "example"
    ],
    "source": "example",
    "threads": [
      "thr_a1b2c3"
    ]
  },
  "output": {
    "ok": true
  }
}
```
