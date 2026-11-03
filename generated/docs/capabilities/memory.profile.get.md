# memory.profile.get

Your profile in this Space, as a chat may use it: the public part always, the private part only where nobody else reads the chat (your own chats, your private Ask); with personId, that teammate's public part

| | |
|---|---|
| Module | memory |
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
| HTTP | POST /v1/memory/profile/get |
| MCP tool | memory_profile (memory) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  threadId?: string;
  personId?: string;
};
```

## Output

```ts
type Out = {
  audience: "private" | "shared";
  basics: Array<{
      key: string;
      label: string;
      value: string;
    }>;
  public: Array<{
      factId: string;
      layer: "person" | "agent" | "project" | "space";
      ownerRef: string;
      agentId?: string;
      noteId?: string;
      text: string;
      validFrom: number;
      validTo?: number;
      learnedAt: number;
      closedAt?: number;
      sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
      sourceRef: string;
      sourceLink?: string;
      status: "proposed" | "current" | "closed" | "removed";
      lowRisk?: boolean;
      trashedAt?: number;
      trashReason?: string;
      archivedAt?: number;
      kind?: string;
      lesson?: {
        how?: "edit" | "refuse" | "reverse" | "rewrite";
        used: number;
        scope: "you" | "proposed" | "space";
      };
      subject?: {
        pageId: string;
        title: string;
        kind: string;
      };
      sourceTitle?: string;
      by?: string;
      byKind?: "person" | "agent" | "upkeep" | "system";
      versions?: number;
      place: "public" | "private";
      suggested?: boolean;
      lineLink?: string;
    }>;
  private: Array<{
      factId: string;
      layer: "person" | "agent" | "project" | "space";
      ownerRef: string;
      agentId?: string;
      noteId?: string;
      text: string;
      validFrom: number;
      validTo?: number;
      learnedAt: number;
      closedAt?: number;
      sourceKind: "chat" | "channel" | "task" | "record" | "run" | "journey" | "manual";
      sourceRef: string;
      sourceLink?: string;
      status: "proposed" | "current" | "closed" | "removed";
      lowRisk?: boolean;
      trashedAt?: number;
      trashReason?: string;
      archivedAt?: number;
      kind?: string;
      lesson?: {
        how?: "edit" | "refuse" | "reverse" | "rewrite";
        used: number;
        scope: "you" | "proposed" | "space";
      };
      subject?: {
        pageId: string;
        title: string;
        kind: string;
      };
      sourceTitle?: string;
      by?: string;
      byKind?: "person" | "agent" | "upkeep" | "system";
      versions?: number;
      place: "public" | "private";
      suggested?: boolean;
      lineLink?: string;
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
    "personId": "usr_a1b2c3",
    "threadId": "thr_a1b2c3"
  },
  "output": {
    "audience": "private",
    "basics": [
      {
        "key": "profile.timezone",
        "label": "example",
        "value": "example"
      }
    ],
    "private": [
      {
        "agentId": "agt_a1b2c3",
        "archivedAt": 1760000000000,
        "by": "example",
        "byKind": "person",
        "closedAt": 1760000000000,
        "factId": "fct_a1b2c3",
        "kind": "example",
        "layer": "person",
        "learnedAt": 1760000000000,
        "lesson": {
          "how": "edit",
          "scope": "you",
          "used": 1
        },
        "lineLink": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
        "lowRisk": true,
        "noteId": "not_a1b2c3",
        "ownerRef": "agt_a1b2c3",
        "place": "public",
        "sourceKind": "chat",
        "sourceLink": "example",
        "sourceRef": "example",
        "sourceTitle": "example",
        "status": "proposed",
        "subject": {
          "kind": "example",
          "pageId": "example",
          "title": "example"
        },
        "suggested": true,
        "text": "example",
        "trashReason": "example",
        "trashedAt": 1760000000000,
        "validFrom": 1760000000000,
        "validTo": 1760000000000,
        "versions": 1
      }
    ],
    "public": [
      {
        "agentId": "agt_a1b2c3",
        "archivedAt": 1760000000000,
        "by": "example",
        "byKind": "person",
        "closedAt": 1760000000000,
        "factId": "fct_a1b2c3",
        "kind": "example",
        "layer": "person",
        "learnedAt": 1760000000000,
        "lesson": {
          "how": "edit",
          "scope": "you",
          "used": 1
        },
        "lineLink": "vyre://thread/thr_a1b2c3?m=msg_a1b2c3",
        "lowRisk": true,
        "noteId": "not_a1b2c3",
        "ownerRef": "agt_a1b2c3",
        "place": "public",
        "sourceKind": "chat",
        "sourceLink": "example",
        "sourceRef": "example",
        "sourceTitle": "example",
        "status": "proposed",
        "subject": {
          "kind": "example",
          "pageId": "example",
          "title": "example"
        },
        "suggested": true,
        "text": "example",
        "trashReason": "example",
        "trashedAt": 1760000000000,
        "validFrom": 1760000000000,
        "validTo": 1760000000000,
        "versions": 1
      }
    ]
  }
}
```
