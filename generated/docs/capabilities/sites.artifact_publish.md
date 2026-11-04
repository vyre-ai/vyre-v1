# sites.artifact_publish

THE way to show something you made: publish it privately; the person gets a card in the chat to open it. The result says whether it was opened for them (opened). Give html, a file or folder in Files, a path on this machine, or a running port. Same title or artifactId updates the same link

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | site (create under /folderId) |
| Gate | none |
| Idempotency | key |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/artifact_publish |
| MCP tool | artifact_publish (sites) |
| CLI | none |
| Emits | site.created, site.published |

## Input

```ts
type In = {
  title: string;
  html?: string;
  fileId?: string;
  folderId?: string;
  path?: string;
  port?: number;
  computerId?: string;
  artifactId?: string;
  idempotencyKey: string;
};
```

## Output

```ts
type Out = {
  artifactId: string;
  url?: string;
  updated: boolean;
  opened: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "artifactId": "sit_a1b2c3",
    "computerId": "cmt_a1b2c3",
    "fileId": "fil_a1b2c3",
    "folderId": "fld_a1b2c3",
    "html": "example",
    "idempotencyKey": "idem_1",
    "path": "example",
    "port": 1,
    "title": "example"
  },
  "output": {
    "artifactId": "sit_a1b2c3",
    "opened": true,
    "updated": true,
    "url": "example"
  }
}
```
