# Memory (memory)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (30)

- [memory.capture](../capabilities/memory.capture.md): Capture at chat end: a cheap-model pass proposes facts to the person layer; channel facts go to the project layer, Automation facts to proposed/
- [memory.counts](../capabilities/memory.counts.md): Counts for the agent strip: current facts, proposed facts and facts from the caller
- [memory.erase](../capabilities/memory.erase.md): Erase completely: delete facts from history; open to the source person or an admin; the audit entry records who and when, never what
- [memory.fact.accept](../capabilities/memory.fact.accept.md): Accept a proposed fact into current memory
- [memory.fact.correct](../capabilities/memory.fact.correct.md): Correct a fact: the old one is closed with today as its end date and a new fact is added
- [memory.fact.get](../capabilities/memory.fact.get.md): Read one fact with its history of closed versions
- [memory.fact.reject](../capabilities/memory.fact.reject.md): Reject a proposed fact
- [memory.facts.list](../capabilities/memory.facts.list.md): List facts by layer, agent, status or "From you"; proposed facts wait here for acceptance
- [memory.facts.remove](../capabilities/memory.facts.remove.md): Remove facts from answers (closed off, kept in history), one at a time or all at once for a layer or agent
- [memory.facts_as_of](../capabilities/memory.facts_as_of.md): Facts that were true on a date (valid_from and valid_to), for "what did it believe on 3 March"
- [memory.find_by_subject](../capabilities/memory.find_by_subject.md): Find every fact and note about one subject (a contact, company or person) for erase and export
- [memory.graph](../capabilities/memory.graph.md): The memory graph for an agent or the Space, built per viewer through access checks; agent, project and Space layers only
- [memory.graph_everything](../capabilities/memory.graph_everything.md): The admin "everything" graph view across all agents; every open is logged
- [memory.graph_export](../capabilities/memory.graph_export.md): Export a graph as a file; personal layers are never included
- [memory.index_graph](../capabilities/memory.index_graph.md): Graph consumer: update graph nodes and edges for a changed note, record or chat (notes, links, relations, came-from)
- [memory.layers.list](../capabilities/memory.layers.list.md): Layers the caller may read for an agent (personal layers are private to their owner)
- [memory.layout.get](../capabilities/memory.layout.get.md): Saved node positions for a graph
- [memory.layout.save](../capabilities/memory.layout.save.md): Save node positions for a graph
- [memory.maintain](../capabilities/memory.maintain.md): Nightly job: merge accepted facts, close old versions, rewrite MAP.md (under 200 lines) for each agent
- [memory.notes.list](../capabilities/memory.notes.list.md): List memory notes of an agent, project or the Space, including proposed/ and recipes/
- [memory.pointer](../capabilities/memory.pointer.md): Pointer block for a message: up to about 5 lines from a local lookup, no model call, deduplicated against the thread
- [memory.promote](../capabilities/memory.promote.md): Promote a fact to the agent, a project or the Space layer; a task for the right approver carries the name and time, no admin needed when the person can edit the target
- [memory.promotion.approve](../capabilities/memory.promotion.approve.md): Approve a promotion request (the approver action on its task)
- [memory.promotion.reject](../capabilities/memory.promotion.reject.md): Reject a promotion request with a note
- [memory.promotion.undo](../capabilities/memory.promotion.undo.md): Undo a promotion: the shared copy is closed and the personal fact stays
- [memory.propose_fact](../capabilities/memory.propose_fact.md): Propose a fact for the asker layer of the agent memory, with its source; low-risk kinds merge on their own
- [memory.read_note](../capabilities/memory.read_note.md): Read one memory note as Markdown
- [memory.restore_version](../capabilities/memory.restore_version.md): Restore a shared memory note to an earlier version (owners and admins)
- [memory.search](../capabilities/memory.search.md): Search notes and current facts the asker may read; BM25, vectors and recency; snippets carry the source link
- [memory.versions](../capabilities/memory.versions.md): List versions of a shared memory note (One History)

## Events (14)

- [memory.captured](../events/memory.captured.md): Capture ran for a thread
- [memory.erased](../events/memory.erased.md): Facts were erased from history (who and when only)
- [memory.everything_viewed](../events/memory.everything_viewed.md): An admin opened the everything graph view
- [memory.fact_accepted](../events/memory.fact_accepted.md): A proposed fact became current
- [memory.fact_corrected](../events/memory.fact_corrected.md): A fact was corrected: the old one closed, a new one added
- [memory.fact_proposed](../events/memory.fact_proposed.md): A fact was proposed (ids and layer only, never the text)
- [memory.fact_rejected](../events/memory.fact_rejected.md): A proposed fact was rejected
- [memory.map_rewritten](../events/memory.map_rewritten.md): MAP.md of an agent was rewritten by the nightly job
- [memory.note_restored](../events/memory.note_restored.md): A shared memory note was restored to an earlier version
- [memory.promoted](../events/memory.promoted.md): A fact was promoted to a shared layer with the name and time of the person
- [memory.promotion_rejected](../events/memory.promotion_rejected.md): A promotion was rejected
- [memory.promotion_requested](../events/memory.promotion_requested.md): A promotion to a shared layer was requested
- [memory.promotion_undone](../events/memory.promotion_undone.md): A promotion was undone
- [memory.removed](../events/memory.removed.md): Facts were removed from answers (kept in history)
