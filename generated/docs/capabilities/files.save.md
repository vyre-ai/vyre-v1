# files.save

Save a guidance file (VYRE.md, AGENT.md, agent.toml, routine prompts): snapshot first, lint, then commit as a version

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/save |
| MCP tool | files_save (files) |
| CLI | none |
| Emits | file.version_added, changeset.opened |

## Input

```ts
type In = {
  fileId: string;
  text: string;
  baseVersion?: number;
  reason?: string;
  acceptWarnings?: boolean;
};
```

## Output

```ts
type Out = {
  versionId: string;
  n: number;
  lint: {
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
  added: number;
  removed: number;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- permission.role_lacks_permission
- validation.bad_input
- validation.not_found
- validation.precondition_failed
- validation.version_conflict

## Example

```json
{
  "name": "example",
  "input": {
    "acceptWarnings": true,
    "baseVersion": 1,
    "fileId": "fil_a1b2c3",
    "reason": "example",
    "text": "example"
  },
  "output": {
    "added": 1,
    "lint": {
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
    },
    "n": 1,
    "removed": 1,
    "versionId": "ver_a1b2c3"
  }
}
```
