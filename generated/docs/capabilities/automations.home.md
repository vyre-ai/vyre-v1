# automations.home

What the Automations first page shows: what needs the person, at most one suggestion the person's Assistant can finish with one approval, the Today line and the header counts

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/home |
| MCP tool | automations_home (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = Record<string, unknown>;
```

## Output

```ts
type Out = {
  needs: Array<{
      id: string;
      automation: string;
      why: string;
      at: number;
      runId?: string;
    }>;
  suggestion?: {
    itemId: string;
    appName: string;
    text: string;
  };
  today: {
    ran: number;
    failed: Array<{
        runId: string;
      }>;
  };
  counts: {
    total: number;
    on: number;
    needYou: number;
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
    "counts": {
      "needYou": 1,
      "on": 1,
      "total": 1
    },
    "needs": [
      {
        "at": 1760000000000,
        "automation": "example",
        "id": "aut_a1b2c3",
        "runId": "run_a1b2c3",
        "why": "example"
      }
    ],
    "suggestion": {
      "appName": "example",
      "itemId": "example",
      "text": "example"
    },
    "today": {
      "failed": [
        {
          "runId": "run_a1b2c3"
        }
      ],
      "ran": 1
    }
  }
}
```
