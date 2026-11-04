# projects.links.link

Link something to a project; an agent that may edit the project can too. A web address or CI run may bring its own state, label and address

| | |
|---|---|
| Module | projects |
| Version | 1 (since 1.0.0) |
| Effects | write |
| Permission | grant only |
| Grant level | edit |
| Risk | medium |
| Resource | project (/projectId) |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | always |
| Team Space only | no |
| HTTP | POST /v1/projects/links/link |
| MCP tool | projects_links_link (records) |
| CLI | none |
| Emits | project.item_linked |

## Input

```ts
type In = {
  projectId: string;
  kind: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
  ref: string;
  state?: string;
  label?: string;
  url?: string;
};
```

## Output

```ts
type Out = {
  link: {
    linkId: string;
    projectId: string;
    kind: "record" | "file" | "chat" | "task" | "artifact" | "mail_thread" | "calendar_event" | "github.pr" | "github.commit" | "ci.run" | "url";
    ref: string;
    source: "manual" | "agent" | "rule";
    addedBy: string;
    ruleId?: string;
    addedAt: number;
    state?: string;
    label?: string;
    url?: string;
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
    "kind": "record",
    "label": "example",
    "projectId": "prj_a1b2c3",
    "ref": "vyre-ai/website#12",
    "state": "example",
    "url": "example"
  },
  "output": {
    "link": {
      "addedAt": 1760000000000,
      "addedBy": "example",
      "kind": "record",
      "label": "example",
      "linkId": "lnk_a1b2c3",
      "projectId": "prj_a1b2c3",
      "ref": "vyre-ai/website#12",
      "ruleId": "example",
      "source": "manual",
      "state": "example",
      "url": "example"
    }
  }
}
```
