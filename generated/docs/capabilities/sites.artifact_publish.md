# sites.artifact_publish

Needs a title and exactly one of html, fileId, folderId, path or port. THE way to show what you made: publishes it privately, the person gets a card to open. Example: artifact_publish {"title":"Q3 plan","html":"<h1>Q3</h1>"}. Same title or artifactId updates the link. No title: its <title> is used

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
  thumb?: string;
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
    "thumb": "example",
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
