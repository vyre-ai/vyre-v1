# projects.for_channel

The project a channel belongs to, if there is one the caller may see

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | channel (/channelId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/projects/for_channel |
| MCP tool | projects_for_channel (records) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  channelId: string;
};
```

## Output

```ts
type Out = {
  projectId?: string;
  recordId?: string;
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
    "channelId": "chn_a1b2c3"
  },
  "output": {
    "projectId": "prj_a1b2c3",
    "recordId": "rec_a1b2c3"
  }
}
```
