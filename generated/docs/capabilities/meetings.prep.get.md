# meetings.prep.get

Your prep notes for an event: whether your Assistant is still working on them, and the notes

| | |
|---|---|
| Module | meetings |
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
| HTTP | POST /v1/meetings/prep/get |
| MCP tool | meetings_prep_get (inbox) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  eventId: string;
};
```

## Output

```ts
type Out = {
  state: "none" | "working" | "ready";
  notes: Array<string>;
  taskId?: string;
  preparedAt?: number;
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
    "eventId": "cev_a1b2c3"
  },
  "output": {
    "notes": [
      "example"
    ],
    "preparedAt": 1760000000000,
    "state": "none",
    "taskId": "tsk_a1b2c3"
  }
}
```
