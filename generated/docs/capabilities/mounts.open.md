# mounts.open

Open a file of a mount: ask the provider what it holds now and fetch the content only when the copy in Vyre is not that version

| | |
|---|---|
| Module | mounts |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | view |
| Risk | medium |
| Resource | file (/fileId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/mounts/open |
| MCP tool | mounts_open (files) |
| CLI | none |
| Emits | file.version_added |

## Input

```ts
type In = {
  fileId: string;
};
```

## Output

```ts
type Out = {
  mounted: boolean;
  fetched: boolean;
  offline?: boolean;
  changesetId?: string;
  source?: {
    mountId: string;
    provider: string;
    remoteId: string;
    cached: boolean;
    conflict: boolean;
    revisionId?: string;
    modifiedAt?: number;
    lastEditedBy?: {
      name?: string;
      email?: string;
    };
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
    "fileId": "fil_a1b2c3"
  },
  "output": {
    "changesetId": "chg_a1b2c3",
    "fetched": true,
    "mounted": true,
    "offline": true,
    "source": {
      "cached": true,
      "conflict": true,
      "lastEditedBy": {
        "email": "example",
        "name": "example"
      },
      "modifiedAt": 1760000000000,
      "mountId": "mnt_a1b2c3",
      "provider": "example",
      "remoteId": "example",
      "revisionId": "example"
    }
  }
}
```
