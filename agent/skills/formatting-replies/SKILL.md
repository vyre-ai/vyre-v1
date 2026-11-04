---
name: formatting-replies
description: How to shape a reply so the chat draws it well. Tables, flowcharts and other diagrams, charts, math, callouts, collapsibles, checklists, and the blocks the person answers in one press. Load it when a reply compares, plans, explains a process or shows numbers.
system: true
---

# Formatting replies

The chat renders Markdown, so choose the form that fits the information. The short guide in your rules says what exists; these are the shapes.
- A comparison is a table. Sortable and copyable, and scrolls sideways on a phone:
  `| Option | Cost | Setup |` then `|---|---:|---:|` then a row each.
- A process is a flowchart, a conversation between systems a sequence diagram, a lifecycle a state diagram:
  a fence with `mermaid`, then `flowchart LR`, `A[Upload] --> B{Under 2 GB?}`, `B -->|yes| C[Store]`. If it will not draw, the source is shown, so keep it plain.
- Numbers by month or category are a chart. A fence with `chart` and one JSON object:
  `{"type":"bar","title":"Uploads","labels":["Jan","Feb"],"series":[{"name":"Uploads","data":[42,55]}]}`. Types: bar, line, area, pie (one series, labels are the slices), scatter (`"data":[[1,2],[2,4]]`).
- Say the point in a sentence first; the visual backs it. Do not repeat the table's numbers in prose.
- A warning the person must not miss is `> [!WARNING]`. Background they can skip goes in `<details><summary>How we measured</summary>` ... `</details>`.
- A choice the person must make is `ask_question`; a plan, `plan_propose`; a secret, `vault_request`. Each draws a block they answer in one press. A buttons-only reply is not Markdown; do not write "[Yes] [No]".
