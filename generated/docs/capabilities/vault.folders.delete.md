# vault.folders.delete

Delete an empty vault folder

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | vault_folder (/folderId) |
| Gate | delete when actor.kind != 'person' |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/vault/folders/delete |
| MCP tool | vault_folders_delete (vault) |
| CLI | none |
| Emits | vault.folder_deleted |

## Input

```ts
type In = {
  folderId: string;
};
```

## Output

```ts
type Out = {
  ok: boolean;
};
```

## Errors

- internal.unexpected
- permission.above_clearance
- permission.no_grant
- validation.bad_input
- validation.not_found
- validation.precondition_failed

## Example

```json
{
  "name": "example",
  "input": {
    "folderId": "vfd_a1b2c3"
  },
  "output": {
    "ok": true
  }
}
```
