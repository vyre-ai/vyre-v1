# journeys.list

List Journeys with their stages count and in-flight records

| | |
|---|---|
| Module | journeys |
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
| HTTP | POST /v1/journeys/list |
| MCP tool | journeys_list (automations) |
| CLI | vyre journeys list |
| Emits | none |

## Input

```ts
type In = {
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  journeys: Array<{
      id: string;
      name: string;
      subjectType: string;
      recordType: string;
      version: number;
      stages: number;
      inFlight: number;
      updatedAt: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "limit": 1
  },
  "output": {
    "journeys": [
      {
        "id": "jrn_a1b2c3",
        "inFlight": 1,
        "name": "example",
        "recordType": "contact",
        "stages": 1,
        "subjectType": "contact",
        "updatedAt": 1760000000000,
        "version": 1
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
