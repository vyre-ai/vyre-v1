# files.lint

Lint a guidance file: line counts against the limits, Inherits VYRE.md, Override lines, secret scan, agent.toml schema, routine prompt files, handoff names, repeated facts

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/lint |
| MCP tool | files_lint (files) |
| CLI | vyre files lint |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  text?: string;
};
```

## Output

```ts
type Out = {
  file: "vyre_md" | "agent_md" | "agent_toml" | "routine_prompt" | "other";
  lines: number;
  state: "ok" | "amber" | "red";
  inherits?: boolean;
  overrides: Array<{
      line: number;
      text: string;
    }>;
  secrets: Array<{
      line: number;
      kind: string;
    }>;
  problems: Array<{
      severity: "info" | "warn" | "error";
      line?: number;
      rule: string;
      message: string;
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3",
    "text": "example"
  },
  "output": {
    "file": "vyre_md",
    "inherits": true,
    "lines": 1,
    "overrides": [
      {
        "line": 1,
        "text": "example"
      }
    ],
    "problems": [
      {
        "line": 1,
        "message": "example",
        "rule": "example",
        "severity": "info"
      }
    ],
    "secrets": [
      {
        "kind": "example",
        "line": 1
      }
    ],
    "state": "ok"
  }
}
```
