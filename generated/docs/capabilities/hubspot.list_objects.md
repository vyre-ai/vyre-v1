# hubspot.list_objects

List remote objects of a type (contacts, companies, deals) for mapping

| | |
|---|---|
| Module | hubspot |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | connection (/connectionId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/hubspot/list_objects |
| MCP tool | hubspot_list_objects (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  connectionId: string;
  objectType: "contacts" | "companies" | "deals";
  cursor?: string;
};
```

## Output

```ts
type Out = {
  objects: Array<Record<string, unknown>>;
  next?: string;
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
    "connectionId": "con_a1b2c3",
    "cursor": "example",
    "objectType": "contacts"
  },
  "output": {
    "next": "example",
    "objects": [
      {}
    ]
  }
}
```
