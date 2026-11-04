# install.list

What was installed from links, by the person asking (an admin may ask for the whole Space)

| | |
|---|---|
| Module | agents |
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
| HTTP | POST /v1/install/list |
| MCP tool | install_list (agents) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  all?: boolean;
};
```

## Output

```ts
type Out = {
  installs: Array<{
      installId: string;
      kind: string;
      name: string;
      version?: string;
      repo: string;
      commit: string;
      url: string;
      by: string;
      at: number;
      installed: Record<string, unknown>;
    }>;
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
    "all": true
  },
  "output": {
    "installs": [
      {
        "at": 1760000000000,
        "by": "example",
        "commit": "example",
        "installId": "ins_a1b2c3",
        "installed": {},
        "kind": "example",
        "name": "example",
        "repo": "example",
        "url": "example",
        "version": "example"
      }
    ]
  }
}
```
