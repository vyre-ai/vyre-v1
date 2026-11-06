# terminal.workspace

An agent's workspace as the Terminal tab shows it: asleep, running, waiting for room (with the line) or not made yet, where it is, whether you may attach and why not; with no machine to run it, one plain line

| | |
|---|---|
| Module | terminal |
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
| HTTP | POST /v1/terminal/workspace |
| MCP tool | terminal_workspace (terminal) |
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
  state: "running" | "asleep" | "waiting" | "none" | "unavailable";
  line?: string;
  host?: "space" | "server";
  nodeId?: string;
  projects?: Array<string>;
  canAttach: boolean;
  cannotAttach?: string;
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
    "agentId": "agt_a1b2c3"
  },
  "output": {
    "canAttach": true,
    "cannotAttach": "example",
    "host": "space",
    "line": "example",
    "nodeId": "example",
    "projects": [
      "prj_a1b2c3"
    ],
    "state": "running"
  }
}
```
