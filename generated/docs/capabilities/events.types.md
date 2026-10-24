# events.types

The event catalogue: names, versions, schemas, and which can start an Automation or raise a notification

| | |
|---|---|
| Module | events |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/events/types |
| MCP tool | events_types (meta) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  prefix?: string;
};
```

## Output

```ts
type Out = {
  types: Array<{
      name: string;
      sv: number;
      summary: string;
      payload: unknown;
      trigger: boolean;
      notify?: string;
    }>;
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
    "prefix": "example"
  },
  "output": {
    "types": [
      {
        "name": "example",
        "notify": "example",
        "payload": {},
        "summary": "example",
        "sv": 1,
        "trigger": true
      }
    ]
  }
}
```
