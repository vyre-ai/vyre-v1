# Console AI and data completion

Binding sources: `team/v1/prep/CONSOLE-SPEC.md` sections 4–6, `manifests/engine.ts`, `manifests/gate.ts`, `manifests/governance.ts`, and `manifests/console-views.ts`.

Root owns Models/providers, Spend/limits, Logging, Review sampling, Incidents, AI policy, Gate configuration, Retention, Holds and Erasure. This work configures existing contracts; durable automation implementation remains with Grok.

1. Add typed edit/confirmation helpers and regressions for monetary limits, restrictive policy selection and expired erasure findings.
2. Implement Models/providers and Spend with real readback, staged changes and explicit impact confirmation.
3. Implement Logging, Review and Incidents with real object details, filters and audited mutations.
4. Implement Gate configuration and AI policy export using existing capabilities and actual file reads.
5. Implement Retention, Holds and Erasure with preview/confirmation, hold handling and actual run state.
6. Mount each page in the standalone Console, verify permissions and production browser flows against a fresh daemon, inspect light/dark captures, then request independent review.

An implemented list is not a completed page. Each page must cover its declared actions and the shared list/object/quick-edit behavior. Missing backend seams stay explicit until fixed and tested. No generated placeholder counts as completion.
