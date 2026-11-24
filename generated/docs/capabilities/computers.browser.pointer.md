# computers.browser.pointer

Where the agent last acted on its browser page, for the desk's cursor; a look that never starts the browser. Who may watch may ask; while a person holds the browser only they get it

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
| HTTP | POST /v1/computers/browser/pointer |
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
  pointer?: {
    seq: number;
    tool: string;
    x: number;
    y: number;
    box?: {
      x: number;
      y: number;
      w: number;
      h: number;
    };
    label?: string;
    at: number;
  };
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
    "by": "usr_a1b2c3",
    "pointer": {
      "at": 1760000000000,
      "box": {
        "h": 1,
        "w": 1,
        "x": 1,
        "y": 1
      },
      "label": "example",
      "seq": 1,
      "tool": "example",
      "x": 1,
      "y": 1
    },
    "state": "live"
  }
}
```
