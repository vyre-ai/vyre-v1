# notes.image

The image of a note (or a clip screenshot), or with part link its link card picture, for someone who may read it

| | |
|---|---|
| Module | notes |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/notes/image |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  noteId: string;
  part?: "image" | "link";
};
```

## Output

```ts
type Out = {
  contentType: string;
  data: string;
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
    "noteId": "nte_a1b2c3",
    "part": "image"
  },
  "output": {
    "contentType": "example",
    "data": "example"
  }
}
```
