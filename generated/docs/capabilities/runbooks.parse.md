# runbooks.parse

Find the fenced shell blocks of a runbook and the saved Runs on target

| | |
|---|---|
| Module | runbooks |
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
| HTTP | POST /v1/runbooks/parse |
| MCP tool | runbooks_parse (terminal) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
  versionId?: string;
};
```

## Output

```ts
type Out = {
  title?: string;
  blocks: Array<{
      blockId: string;
      index: number;
      lang: "sh" | "bash";
      code: string;
      title?: string;
      line: number;
    }>;
  runsOn?: {
    kind: "server" | "computer";
    computerId?: string;
  };
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
    "versionId": "ver_a1b2c3"
  },
  "output": {
    "blocks": [
      {
        "blockId": "b2_9fc1",
        "code": "example",
        "index": 1,
        "lang": "sh",
        "line": 1,
        "title": "example"
      }
    ],
    "runsOn": {
      "computerId": "cmt_a1b2c3",
      "kind": "server"
    },
    "title": "example"
  }
}
```
