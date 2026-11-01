# automations.code_reach

System: a code step that names hosts asks the Gate before the sandbox opens to them. It does nothing itself

| | |
|---|---|
| Module | automations |
| Version | 1 (since 1.0.0) |
| Effects | outward |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | space |
| Gate | send |
| Idempotency | key |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/automations/code_reach |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  hosts: Array<string>;
  idempotencyKey: string;
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
- provider.network
- provider.unavailable
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "hosts": [
      "example"
    ],
    "idempotencyKey": "idem_1"
  },
  "output": {
    "ok": true
  }
}
```
