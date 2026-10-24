# console.assistant_open

Open the Console assistant thread (kind console) with the current page as a context block

| | |
|---|---|
| Module | console-assistant |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | console.access |
| Grant level | edit |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/console/assistant_open |
| MCP tool | console_assistant_open (engineer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  page: string;
  objectRef?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  threadId: string;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input

## Example

```json
{
  "name": "example",
  "input": {
    "idempotencyKey": "idem_1",
    "objectRef": "example",
    "page": "access.roles"
  },
  "output": {
    "threadId": "thr_a1b2c3"
  }
}
```
