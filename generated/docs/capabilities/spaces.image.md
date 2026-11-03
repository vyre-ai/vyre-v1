# spaces.image

The Space image for its faces (the rail tile, the switcher, the join and sign-in pages, invites): a data: address of the picture, sent only when it differs from the logoFileId the caller already shows

| | |
|---|---|
| Module | spaces |
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
| HTTP | POST /v1/spaces/image |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  known?: string;
};
```

## Output

```ts
type Out = {
  logoFileId?: string;
  image?: string;
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
    "known": "fil_a1b2c3"
  },
  "output": {
    "image": "example",
    "logoFileId": "fil_a1b2c3"
  }
}
```
