# computers.screen.click

Click at screen coordinates

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | computers.use |
| Grant level | edit |
| Risk | medium |
| Resource | computer (/computerId) |
| Gate | none |
| Idempotency | none |
| Offline | online |
| Audit | none |
| Team Space only | yes |
| HTTP | POST /v1/computers/screen/click |
| MCP tool | screen_click (computer) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  computerId?: string;
  x: number;
  y: number;
  button?: "left" | "right" | "middle";
  double?: boolean;
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
- permission.needs_team
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- timeout.deadline
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "button": "left",
    "computerId": "cmt_a1b2c3",
    "double": true,
    "x": 1,
    "y": 1
  },
  "output": {
    "ok": true
  }
}
```
