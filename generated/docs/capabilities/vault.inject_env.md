# vault.inject_env

Inject a folder into one child process environment (vyre run --env folder -- command); returns key names only

| | |
|---|---|
| Module | vault |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | use |
| Risk | medium |
| Resource | vault_folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | sensitive |
| Team Space only | no |
| HTTP | POST /v1/vault/inject_env |
| MCP tool | vault_inject_env (vault) |
| CLI | vyre run --env |
| Emits | vault.used |

## Input

```ts
type In = {
  folderId: string;
  purpose?: string;
};
```

## Output

```ts
type Out = {
  handles: Array<string>;
  keys: Array<string>;
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
    "folderId": "vfd_a1b2c3",
    "purpose": "example"
  },
  "output": {
    "handles": [
      "#Dana_Lawmatics"
    ],
    "keys": [
      "api_key"
    ]
  }
}
```
