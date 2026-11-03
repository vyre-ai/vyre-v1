# files.agent_access.set

Set Agent access on a folder or a file (on Available, redact Redacted, off Not available); null follows the folder above

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | manage |
| Risk | medium |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/files/agent_access/set |
| MCP tool | none |
| CLI | none |
| Emits | file.agent_access_changed, folder.agent_access_changed |

## Input

```ts
type In = {
  target: {
    type: "file" | "folder";
    id: string;
  };
  value: ("on" | "redact" | "off") | null;
};
```

## Output

```ts
type Out = {
  value: "on" | "redact" | "off";
  own: boolean;
  inherited: "on" | "redact" | "off";
  from?: {
    kind: "file" | "folder";
    id: string;
    name: string;
  };
  setBy?: string;
  setAt?: number;
  overrides?: Array<{
      kind: "file" | "folder";
      id: string;
      name: string;
      value: "on" | "redact" | "off";
    }>;
  files?: number;
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
    "target": {
      "id": "fil_a1b2c3",
      "type": "file"
    },
    "value": "on"
  },
  "output": {
    "files": 1,
    "from": {
      "id": "example",
      "kind": "file",
      "name": "example"
    },
    "inherited": "on",
    "overrides": [
      {
        "id": "example",
        "kind": "file",
        "name": "example",
        "value": "on"
      }
    ],
    "own": true,
    "setAt": 1760000000000,
    "setBy": "example",
    "value": "on"
  }
}
```
