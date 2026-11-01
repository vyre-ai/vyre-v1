# connectors.sync_poll

Keep a synced type current when the app has no webhook: pull what changed, push what people changed here, and schedule the next poll (called by the scheduler)

| | |
|---|---|
| Module | connectors |
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
| HTTP | POST /v1/connectors/sync_poll |
| MCP tool | none |
| CLI | none |
| Emits | sync.completed, sync.conflict, sync.deletes_paused, sync.pushed, sync.push_failed, record.created, record.updated |

## Input

```ts
type In = {
  type: string;
};
```

## Output

```ts
type Out = {
  ran: boolean;
  summary?: string;
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
    "type": "contact"
  },
  "output": {
    "ran": true,
    "summary": "example"
  }
}
```
