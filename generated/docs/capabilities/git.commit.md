# git.commit

Commit working-copy changes (all or the given paths); authored by the first editor, person or agent

| | |
|---|---|
| Module | git |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | files.write |
| Grant level | edit |
| Risk | medium |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/git/commit |
| MCP tool | git_commit (files) |
| CLI | vyre git commit |
| Emits | git.committed, file.version_added |

## Input

```ts
type In = {
  folderId: string;
  message: string;
  paths?: Array<string>;
  author?: {
    name: string;
    kind: "person" | "agent" | "actor" | "external";
    id?: string;
  };
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  sha: string;
  files: number;
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

## Example

```json
{
  "name": "example",
  "input": {
    "author": {
      "id": "example",
      "kind": "person",
      "name": "example"
    },
    "folderId": "fld_a1b2c3",
    "idempotencyKey": "idem_1",
    "message": "example",
    "paths": [
      "example"
    ]
  },
  "output": {
    "files": 1,
    "sha": "9fceb02"
  }
}
```
