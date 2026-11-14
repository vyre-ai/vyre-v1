# chats.sidebar

The Chats sidebar in one answer: what needs me, my goals, pinned, chats, channels and team, each with its first rows, its total and its marks, plus the one number for the rail

| | |
|---|---|
| Module | chat |
| Version | 1 (since 1.0.0) |
| Effects | read |
| Permission | grant only |
| Grant level | member |
| Risk | low |
| Resource | space |
| Gate | none |
| Idempotency | natural |
| Offline | online |
| Audit | none |
| Team Space only | no |
| HTTP | POST /v1/chats/sidebar |
| MCP tool | chats_sidebar (chats) |
| CLI | none |
| Emits | none |

## Input

```ts
type In = {
  filter?: string;
  more?: {
    section: "goals" | "pinned" | "chats" | "channels" | "team";
    after?: string;
    limit?: number;
  };
};
```

## Output

```ts
type Out = {
  needs: {
    total: number;
    items: Array<{
        taskId: string;
        title: string;
        verb: "Allow" | "Review" | "Answer" | "Blocked" | "Sign";
        askerId?: string;
      }>;
  };
  goals: {
    total: number;
    rows: Array<{
        key: string;
        kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
        title: string;
        faceIds: Array<string>;
        unread: number;
        mentions: number;
        failed: boolean;
        failedLine?: string;
        working: boolean;
        muted: boolean;
        pinned: number | null;
        lastAt: number;
        threadId?: string;
        personId?: string;
        agentId?: string;
        progress?: {
          done: number;
          total: number;
        };
        line?: string;
        nextCheckinAt?: number;
        quiet?: boolean;
        ended?: boolean;
        archived?: boolean;
        private?: boolean;
        withPeople?: boolean;
      }>;
    next?: string;
  };
  pinned: {
    total: number;
    rows: Array<{
        key: string;
        kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
        title: string;
        faceIds: Array<string>;
        unread: number;
        mentions: number;
        failed: boolean;
        failedLine?: string;
        working: boolean;
        muted: boolean;
        pinned: number | null;
        lastAt: number;
        threadId?: string;
        personId?: string;
        agentId?: string;
        progress?: {
          done: number;
          total: number;
        };
        line?: string;
        nextCheckinAt?: number;
        quiet?: boolean;
        ended?: boolean;
        archived?: boolean;
        private?: boolean;
        withPeople?: boolean;
      }>;
    next?: string;
  };
  chats: {
    total: number;
    rows: Array<{
        key: string;
        kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
        title: string;
        faceIds: Array<string>;
        unread: number;
        mentions: number;
        failed: boolean;
        failedLine?: string;
        working: boolean;
        muted: boolean;
        pinned: number | null;
        lastAt: number;
        threadId?: string;
        personId?: string;
        agentId?: string;
        progress?: {
          done: number;
          total: number;
        };
        line?: string;
        nextCheckinAt?: number;
        quiet?: boolean;
        ended?: boolean;
        archived?: boolean;
        private?: boolean;
        withPeople?: boolean;
      }>;
    next?: string;
  };
  channels: {
    total: number;
    rows: Array<{
        key: string;
        kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
        title: string;
        faceIds: Array<string>;
        unread: number;
        mentions: number;
        failed: boolean;
        failedLine?: string;
        working: boolean;
        muted: boolean;
        pinned: number | null;
        lastAt: number;
        threadId?: string;
        personId?: string;
        agentId?: string;
        progress?: {
          done: number;
          total: number;
        };
        line?: string;
        nextCheckinAt?: number;
        quiet?: boolean;
        ended?: boolean;
        archived?: boolean;
        private?: boolean;
        withPeople?: boolean;
      }>;
    next?: string;
  };
  team: {
    total: number;
    rows: Array<{
        key: string;
        kind: "chat" | "channel" | "project" | "goal" | "person" | "agent";
        title: string;
        faceIds: Array<string>;
        unread: number;
        mentions: number;
        failed: boolean;
        failedLine?: string;
        working: boolean;
        muted: boolean;
        pinned: number | null;
        lastAt: number;
        threadId?: string;
        personId?: string;
        agentId?: string;
        progress?: {
          done: number;
          total: number;
        };
        line?: string;
        nextCheckinAt?: number;
        quiet?: boolean;
        ended?: boolean;
        archived?: boolean;
        private?: boolean;
        withPeople?: boolean;
      }>;
    next?: string;
  };
  rail: number;
  nextUnread?: string;
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
    "filter": "example",
    "more": {
      "after": "example",
      "limit": 1,
      "section": "goals"
    }
  },
  "output": {
    "channels": {
      "next": "example",
      "rows": [
        {
          "agentId": "example",
          "archived": true,
          "ended": true,
          "faceIds": [
            "example"
          ],
          "failed": true,
          "failedLine": "example",
          "key": "example",
          "kind": "chat",
          "lastAt": 1760000000000,
          "line": "example",
          "mentions": 1,
          "muted": true,
          "nextCheckinAt": 1760000000000,
          "personId": "example",
          "pinned": 1,
          "private": true,
          "progress": {
            "done": 1,
            "total": 1
          },
          "quiet": true,
          "threadId": "thr_a1b2c3",
          "title": "example",
          "unread": 1,
          "withPeople": true,
          "working": true
        }
      ],
      "total": 1
    },
    "chats": {
      "next": "example",
      "rows": [
        {
          "agentId": "example",
          "archived": true,
          "ended": true,
          "faceIds": [
            "example"
          ],
          "failed": true,
          "failedLine": "example",
          "key": "example",
          "kind": "chat",
          "lastAt": 1760000000000,
          "line": "example",
          "mentions": 1,
          "muted": true,
          "nextCheckinAt": 1760000000000,
          "personId": "example",
          "pinned": 1,
          "private": true,
          "progress": {
            "done": 1,
            "total": 1
          },
          "quiet": true,
          "threadId": "thr_a1b2c3",
          "title": "example",
          "unread": 1,
          "withPeople": true,
          "working": true
        }
      ],
      "total": 1
    },
    "goals": {
      "next": "example",
      "rows": [
        {
          "agentId": "example",
          "archived": true,
          "ended": true,
          "faceIds": [
            "example"
          ],
          "failed": true,
          "failedLine": "example",
          "key": "example",
          "kind": "chat",
          "lastAt": 1760000000000,
          "line": "example",
          "mentions": 1,
          "muted": true,
          "nextCheckinAt": 1760000000000,
          "personId": "example",
          "pinned": 1,
          "private": true,
          "progress": {
            "done": 1,
            "total": 1
          },
          "quiet": true,
          "threadId": "thr_a1b2c3",
          "title": "example",
          "unread": 1,
          "withPeople": true,
          "working": true
        }
      ],
      "total": 1
    },
    "needs": {
      "items": [
        {
          "askerId": "example",
          "taskId": "example",
          "title": "example",
          "verb": "Allow"
        }
      ],
      "total": 1
    },
    "nextUnread": "example",
    "pinned": {
      "next": "example",
      "rows": [
        {
          "agentId": "example",
          "archived": true,
          "ended": true,
          "faceIds": [
            "example"
          ],
          "failed": true,
          "failedLine": "example",
          "key": "example",
          "kind": "chat",
          "lastAt": 1760000000000,
          "line": "example",
          "mentions": 1,
          "muted": true,
          "nextCheckinAt": 1760000000000,
          "personId": "example",
          "pinned": 1,
          "private": true,
          "progress": {
            "done": 1,
            "total": 1
          },
          "quiet": true,
          "threadId": "thr_a1b2c3",
          "title": "example",
          "unread": 1,
          "withPeople": true,
          "working": true
        }
      ],
      "total": 1
    },
    "rail": 1,
    "team": {
      "next": "example",
      "rows": [
        {
          "agentId": "example",
          "archived": true,
          "ended": true,
          "faceIds": [
            "example"
          ],
          "failed": true,
          "failedLine": "example",
          "key": "example",
          "kind": "chat",
          "lastAt": 1760000000000,
          "line": "example",
          "mentions": 1,
          "muted": true,
          "nextCheckinAt": 1760000000000,
          "personId": "example",
          "pinned": 1,
          "private": true,
          "progress": {
            "done": 1,
            "total": 1
          },
          "quiet": true,
          "threadId": "thr_a1b2c3",
          "title": "example",
          "unread": 1,
          "withPeople": true,
          "working": true
        }
      ],
      "total": 1
    }
  }
}
```
