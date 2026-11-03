# meetings.prep.save

The Assistant's prep notes for an event, a few short lines

| | |
|---|---|
| Module | meetings |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/meetings/prep/save |
| MCP tool | meetings_prep_save (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  eventId: string;
  notes: Array<string>;
};
```

## Output

```ts
type Out = {
  state: "none" | "working" | "ready";
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "eventId": "cev_a1b2c3",
    "notes": [
      "example"
    ]
  },
  "output": {
    "state": "none"
  }
}
```
