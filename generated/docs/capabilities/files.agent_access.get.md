# files.agent_access.get

What agents may read in a folder or of a file: Available, Redacted or Not available, where it comes from, and what is set differently inside

| | |
|---|---|
| Module | files |
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
| HTTP | POST /v1/files/agent_access/get |
| MCP tool | files_agent_access_get (files) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  target: {
    type: "file" | "folder";
    id: string;
  };
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
    }
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
