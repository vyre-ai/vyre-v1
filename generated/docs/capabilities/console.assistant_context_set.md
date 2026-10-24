# console.assistant_context_set

Update the page context block as the person navigates

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | edit |
| Risk | medium |
| Resource | thread (/threadId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/assistant_context_set |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId: string;
  page: string;
  objectRef?: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "objectRef": "example",
    "page": "example",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
