# files.agent_states

Redaction for AI in a folder: each file's badge (Reviewed, Needs review, Not available to AI), each subfolder's setting and how many below it wait, and the files to review next

| | |
|---|---|
| Module | files |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | view |
| Risk | low |
| Resource | folder (/folderId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/files/agent_states |
| MCP tool | none |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  folderId: string;
};
```

## Output

```ts
type Out = {
  access: {
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
  needs: number;
  queue: Array<string>;
  files: Array<{
      fileId: string;
      state: "clear" | "hidden" | "reviewed" | "needs_review" | "off";
      own: boolean;
      waiting?: Array<string>;
    }>;
  folders: Array<{
      folderId: string;
      value: "on" | "redact" | "off";
      own: boolean;
      needs: number;
    }>;
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
    "folderId": "fld_a1b2c3"
  },
  "output": {
    "access": {
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
    },
    "files": [
      {
        "fileId": "fil_a1b2c3",
        "own": true,
        "state": "clear",
        "waiting": [
          "example"
        ]
      }
    ],
    "folders": [
      {
        "folderId": "fld_a1b2c3",
        "needs": 1,
        "own": true,
        "value": "on"
      }
    ],
    "needs": 1,
    "queue": [
      "fil_a1b2c3"
    ]
  }
}
```
