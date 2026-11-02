# gate.grants.give_back

System: hand back the turn grants a call spent when the call was refused before it went out; only the server may call it

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
| HTTP | POST /v1/gate/grants/give_back |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  ids: Array<string>;
};
```

## Output

```ts
type Out = {
  returned: number;
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
    "ids": [
      "example"
    ]
  },
  "output": {
    "returned": 1
  }
}
```
