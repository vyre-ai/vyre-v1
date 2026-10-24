# search.index.apply

Index consumer: apply one changed entity row to full text and vectors (durable cursor; never sees end-to-end rows)

| | |
|---|---|
| Module | search |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/search/index/apply |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  entity: string;
  id: string;
  op: "upsert" | "delete";
  seq: number;
};
```

## Output

```ts
type Out = {
  indexed: boolean;
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
    "entity": "example",
    "id": "example",
    "op": "upsert",
    "seq": 1
  },
  "output": {
    "indexed": true
  }
}
```
