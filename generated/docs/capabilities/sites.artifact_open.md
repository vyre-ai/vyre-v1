# sites.artifact_open

A short-lived address that opens an artifact for the person asking, in a tab or the browser

| | |
|---|---|
| Module | sites |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | site (/artifactId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/sites/artifact_open |
| MCP tool | sites_artifact_open (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  artifactId: string;
};
```

## Output

```ts
type Out = {
  path: string;
  url?: string;
  expiresAt: number;
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
    "artifactId": "sit_a1b2c3"
  },
  "output": {
    "expiresAt": 1760000000000,
    "path": "example",
    "url": "example"
  }
}
```
