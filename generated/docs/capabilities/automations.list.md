# automations.list

List Automations by section (Personal, Shared with me, Space), folder and Group

| | |
|---|---|
| Module | automations |
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
| HTTP | POST /v1/automations/list |
| MCP tool | automations_list (automations) |
| CLI | vyre automations list |
| Emits | none |

## Input

```ts
type In = {
  section?: "personal" | "shared" | "space";
  folder?: string;
  groupId?: string;
  status?: "on" | "off" | "draft" | "paused";
  q?: string;
  cursor?: string;
  limit?: number;
};
```

## Output

```ts
type Out = {
  automations: Array<{
      id: string;
      name: string;
      kind: "personal" | "space";
      groupId?: string;
      ownerId: string;
      status: "on" | "off" | "draft" | "paused";
      version: number;
      triggers: Array<string>;
      updatedAt: number;
      lastRun?: {
        runId: string;
        status: string;
        at: number;
      };
      failedRuns: number;
    }>;
  next?: string;
  total?: number;
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
    "cursor": "example",
    "folder": "fld_a1b2c3",
    "groupId": "agr_a1b2c3",
    "limit": 1,
    "q": "example",
    "section": "personal",
    "status": "on"
  },
  "output": {
    "automations": [
      {
        "failedRuns": 1,
        "groupId": "agr_a1b2c3",
        "id": "aut_a1b2c3",
        "kind": "personal",
        "lastRun": {
          "at": 1760000000000,
          "runId": "run_a1b2c3",
          "status": "example"
        },
        "name": "example",
        "ownerId": "example",
        "status": "on",
        "triggers": [
          "example"
        ],
        "updatedAt": 1760000000000,
        "version": 1
      }
    ],
    "next": "example",
    "total": 1
  }
}
```
