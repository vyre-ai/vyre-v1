# journeys.where

Where one record is on its Journey and how long it has been in its stage

| | |
|---|---|
| Module | journeys |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | record (/recordId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/journeys/where |
| MCP tool | journeys_where (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  journeyId: string;
  recordId: string;
};
```

## Output

```ts
type Out = {
  journeyId: string;
  recordId: string;
  stage: string;
  stageTitle: string;
  enteredAt: number;
  hoursIn: number;
  completed: boolean;
  limitHours?: number;
  overByHours?: number;
  thenAsks?: {
    kind: "role" | "person";
    id: string;
  };
  path: Array<{
      key: string;
      title: string;
      state: "done" | "here" | "next";
      final: boolean;
      automations: Array<string>;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.not_found
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "journeyId": "jrn_a1b2c3",
    "recordId": "rec_a1b2c3"
  },
  "output": {
    "completed": true,
    "enteredAt": 1760000000000,
    "hoursIn": 1,
    "journeyId": "jrn_a1b2c3",
    "limitHours": 1,
    "overByHours": 1,
    "path": [
      {
        "automations": [
          "aut_a1b2c3"
        ],
        "final": true,
        "key": "intake",
        "state": "done",
        "title": "example"
      }
    ],
    "recordId": "rec_a1b2c3",
    "stage": "intake",
    "stageTitle": "example",
    "thenAsks": {
      "id": "example",
      "kind": "role"
    }
  }
}
```
