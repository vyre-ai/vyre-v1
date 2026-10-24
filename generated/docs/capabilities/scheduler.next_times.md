# scheduler.next_times

The next fire times of a cron or schedule, for the editor preview

| | |
|---|---|
| Module | scheduler-api |
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
| HTTP | POST /v1/scheduler/next_times |
| MCP tool | scheduler_next_times (automations) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  cron: string;
  tz: string;
  count?: number;
};
```

## Output

```ts
type Out = {
  times: Array<number>;
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
    "count": 1,
    "cron": "0 9 * * 1-5",
    "tz": "Asia/Karachi"
  },
  "output": {
    "times": [
      1760000000000
    ]
  }
}
```
