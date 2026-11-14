# connectors.check_key

Try the key a person typed against the app before it is stored; answers ok, rejected or unreachable and never repeats the key

| | |
|---|---|
| Module | connectors |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | member |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/connectors/check_key |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connector: string;
  secrets: Record<string, string>;
};
```

## Output

```ts
type Out = {
  result: "ok" | "rejected" | "unreachable";
  tested?: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "connector": "hubspot",
    "secrets": {}
  },
  "output": {
    "result": "ok",
    "tested": "example"
  }
}
```
