# computers.browser.preview

One still picture of an agent's browser for the Computer tab, from the Space; it never wakes the browser (asleep answers no picture). Who may watch the live view may ask; a person never sees a page that a sign-in hides from them

| | |
|---|---|
| Module | computers |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | computers.watch |
| Grant level | view |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/computers/browser/preview |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  agentId: string;
};
```

## Output

```ts
type Out = {
  state: "live" | "asleep" | "held";
  by?: string;
  png?: string;
  width?: number;
  height?: number;
  at: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "at": 1760000000000,
    "by": "usr_a1b2c3",
    "height": 1,
    "png": "example",
    "state": "live",
    "width": 1
  }
}
```
