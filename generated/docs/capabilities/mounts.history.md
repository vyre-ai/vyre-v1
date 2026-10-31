# mounts.history

The provider's revisions of a file, newest first, with who saved each (the person or agent for edits sent from Vyre)

| | |
|---|---|
| Module | mounts |
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
| HTTP | POST /v1/mounts/history |
| MCP tool | mounts_history (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  revisions: Array<{
      revisionId: string;
      at?: number;
      size?: number;
      current: boolean;
      by?: {
        name?: string;
        email?: string;
        actor?: string;
      };
    }>;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- provider.auth_failed
- provider.unavailable
- validation.bad_input
- validation.not_found

## Example

```json
{
  "name": "example",
  "input": {
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "revisions": [
      {
        "at": 1760000000000,
        "by": {
          "actor": "example",
          "email": "example",
          "name": "example"
        },
        "current": true,
        "revisionId": "example",
        "size": 1
      }
    ]
  }
}
```
