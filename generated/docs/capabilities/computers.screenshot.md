# computers.screenshot

One screenshot of the computer, stored in the agent folder

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/screenshot |
| MCP tool | computers_screenshot (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId: string;
};
```

## Output

```ts
type Out = {
  fileId: string;
  width: number;
  height: number;
  at: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "computerId": "cmt_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "fileId": "fil_a1b2c3",
    "height": 1,
    "width": 1
  }
}
```
