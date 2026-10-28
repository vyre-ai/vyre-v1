# Infrastructure completion increment

Base: f277e080. This increment owns Network, Speed and Usage. Existing Console components and server-pruned navigation remain the composition.

Network reads status, endpoints, public hostnames and servers through their normal capabilities. Domain, address mode, renewal and removal require a review step. Reconnect and join code use their existing capabilities. A queued host command is described as requested; only observed status establishes the result. Gate-held actions retain their approval state. Speed uses the checked-in budget units and direction, including lower-tail budgets, and opens retained worst traces only for callers with server.logs. Usage has independent period and person/agent/model grouping; it is not the Spend editor.

## Evidence

- Four new rendering and actual route-dispatch tests; seventeen focused Console tests pass with existing Infrastructure and AI route coverage.
- Real production browser: fresh claim, three routes, domain review and server validation, expiring join code, Speed window and Usage period/group changes. Three tests pass, no page errors. Captures: /tmp/vyre-infra-acceptance-shots.
- Export uses APFS-cloned dependencies with local @vyre/app and @vyre/ui workspace resolution. New Network marker is present in client JS, home includes external scripts.
- Focused semantic checks report no diagnostics in the new pages; existing shared UI Menu and States errors remain outside this increment.
- Host regression proves first successful domain apply updates observed network_config and a failed apply keeps the prior address. Fifteen command/probe tests pass.

## Remaining action audit

The default daemon network port has no route or reconnect driver; successful no-op applyAddress/disconnect are not adequate release behavior. The existing CaddyRouter supports ingress configuration and certificate inspection. A separate next increment must connect this existing driver and expose failures rather than infer success from DNS. Public network mutations are not exercised against the operator’s real infrastructure by these fixture tests.
