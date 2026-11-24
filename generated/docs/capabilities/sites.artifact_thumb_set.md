# sites.artifact_thumb_set

Keep an artifact's small picture (from the Vyre for Chrome extension) only if none or changed

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
| HTTP | POST /v1/sites/artifact_thumb_set |
| MCP tool | sites_artifact_thumb_set (sites) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  artifactId: string;
  thumb: string;
};
```

## Output

```ts
type Out = {
  set: boolean;
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
    "artifactId": "sit_a1b2c3",
    "thumb": "example"
  },
  "output": {
    "set": true
  }
}
```
