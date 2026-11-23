# automations.stage_offers

Space Automations that start on a stage of a Journey's type and are not part of it

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
| HTTP | POST /v1/automations/stage_offers |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  recordType: string;
  stageField?: string;
  stages: Array<string>;
  members?: Array<string>;
};
```

## Output

```ts
type Out = {
  offers: Array<{
      automationId: string;
      name: string;
      stage: string;
      on: boolean;
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
    "members": [
      "aut_a1b2c3"
    ],
    "recordType": "contact",
    "stageField": "example",
    "stages": [
      "example"
    ]
  },
  "output": {
    "offers": [
      {
        "automationId": "aut_a1b2c3",
        "name": "example",
        "on": true,
        "stage": "example"
      }
    ]
  }
}
```
