# Memory (memory)

Lane L2. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (50)

- [memory.archive_sweep](../capabilities/memory.archive_sweep.md): Daily job: move facts untouched in Trash for the Space setting (30 to 90 days, default 60) to Archive
- [memory.backlinks](../capabilities/memory.backlinks.md): Where a page is linked from: other pages, chats, runs and records, each with the line that names it; only places the reader can open
- [memory.capture](../capabilities/memory.capture.md): Capture at chat end: a cheap-model pass proposes facts to the person layer; channel facts go to the project layer, Automation facts to proposed/
- [memory.counts](../capabilities/memory.counts.md): Counts for the agent strip: current facts, proposed facts, facts from the caller and facts merged on their own
- [memory.erase](../capabilities/memory.erase.md): Erase completely: delete facts from history; open to the source person or an admin; the audit entry records who and when, never what
- [memory.export_markdown](../capabilities/memory.export_markdown.md): The whole brain the reader can see as one Markdown document: pages with their facts, Notes and links, then the facts no page names; personal memory only when asked, and only the reader's own
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
- [memory.learned](../capabilities/memory.learned.md): The Learned feed: what memory learned, newest first, with its source and who learned it, for what the reader can see; each row can be undone
- [memory.maintain](../capabilities/memory.maintain.md): Upkeep, nightly or on demand: merge duplicates into Trash, flag contradictions and old facts as questions, close expired facts, and with a memory key let a model do the rest; rewrite MAP.md for each agent
- [memory.map.get](../capabilities/memory.map.get.md): The MAP.md block of an agent as the nightly job last wrote it (agent layer only, never personal memory); absent before the first night
- [memory.meaning.status](../capabilities/memory.meaning.status.md): Whether meaning search is on, which model it uses, how many documents have a vector and, when it is not, a plain reason (not set up reads healthy)
- [memory.notes.erase](../capabilities/memory.notes.erase.md): Erase one memory note for good, with its graph node and links (governance erase)
- [memory.notes.list](../capabilities/memory.notes.list.md): List memory notes of an agent, project or the Space, including proposed/ and recipes/
- [memory.page.delete](../capabilities/memory.page.delete.md): Move a page to Trash; memory.restore brings it back
- [memory.page.get](../capabilities/memory.page.get.md): Open a page by id or title: its facts, its Notes, the [[links]] it makes and the chats, runs, records and pages that link to it
- [memory.page.list](../capabilities/memory.page.list.md): List the pages the reader can see, by words in the title or Notes, layer, kind, agent or project
- [memory.page.put](../capabilities/memory.page.put.md): Write the Notes of a page as a new version (making the page when it is new); [[links]] in the Notes become labelled edges, each with the line it was written in
- [memory.page.restore_version](../capabilities/memory.page.restore_version.md): Write an earlier version of the Notes back as a new version (the versions in between stay)
- [memory.page.versions](../capabilities/memory.page.versions.md): Every version of the Notes of a page, newest first, with who wrote it and when
- [memory.pointer](../capabilities/memory.pointer.md): Pointer block for a message: up to about 5 lines from a local lookup, no model call, deduplicated against the thread
- [memory.promote](../capabilities/memory.promote.md): Promote a fact to the agent, a project or the Space layer; a task for the right approver carries the name and time, no admin needed when the person can edit the target
- [memory.promotion.approve](../capabilities/memory.promotion.approve.md): Approve a promotion request (the approver action on its task)
- [memory.promotion.reject](../capabilities/memory.promotion.reject.md): Reject a promotion request with a note
- [memory.promotion.undo](../capabilities/memory.promotion.undo.md): Undo a promotion: the shared copy is closed and the personal fact stays
- [memory.propose_fact](../capabilities/memory.propose_fact.md): Propose a fact for the asker layer of the agent memory, with its source; low-risk kinds merge on their own
- [memory.question.resolve](../capabilities/memory.question.resolve.md): Answer an upkeep question with one click: keep one of two facts (the other goes to Trash), keep both, confirm an old fact, or drop it
- [memory.questions.list](../capabilities/memory.questions.list.md): Questions upkeep could not settle: two values for one subject and field, or a fact that looks old
- [memory.read_note](../capabilities/memory.read_note.md): Read one memory note as Markdown
- [memory.restore](../capabilities/memory.restore.md): Restore a fact from Trash, or from Archive for an admin; open to any person or agent who can see the fact
- [memory.restore_version](../capabilities/memory.restore_version.md): Restore a shared memory note to an earlier version (owners and admins)
- [memory.search](../capabilities/memory.search.md): Search notes and current facts the asker may read; BM25, vectors and recency; snippets carry the source link
- [memory.trail](../capabilities/memory.trail.md): The trail of changes to facts and pages (who, what, when, why and source), for what the reader can see; rows are never deleted and never hold content
- [memory.trash.search](../capabilities/memory.trash.search.md): Search Trash (or Archive, for an admin): deleted and merged-away facts, which normal search and recall never show
- [memory.undo](../capabilities/memory.undo.md): Undo something memory learned: the fact goes to Trash with the reason undone, and a restore brings it back
- [memory.upkeep.status](../capabilities/memory.upkeep.status.md): Upkeep spend: this month against the monthly cap, and the recent runs with what each did and cost
- [memory.versions](../capabilities/memory.versions.md): List versions of a shared memory note (One History)

## Events (20)

- [memory.archived](../events/memory.archived.md): Facts untouched in Trash moved to Archive
- [memory.captured](../events/memory.captured.md): Capture ran for a thread
- [memory.erased](../events/memory.erased.md): Facts were erased from history (who and when only)
- [memory.everything_viewed](../events/memory.everything_viewed.md): An admin opened the everything graph view
- [memory.fact_accepted](../events/memory.fact_accepted.md): A proposed fact became current
- [memory.fact_corrected](../events/memory.fact_corrected.md): A fact was corrected: the old one closed, a new one added
- [memory.fact_proposed](../events/memory.fact_proposed.md): A fact was proposed (ids and layer only, never the text)
- [memory.fact_rejected](../events/memory.fact_rejected.md): A proposed fact was rejected
- [memory.learned](../events/memory.learned.md): Memory learned a fact (ids and places only, never the text); the Learned feed reads this
- [memory.map_rewritten](../events/memory.map_rewritten.md): MAP.md of an agent was rewritten by the nightly job
- [memory.note_restored](../events/memory.note_restored.md): A shared memory note was restored to an earlier version
- [memory.page_restored](../events/memory.page_restored.md): A page came back from Trash or Archive
- [memory.promoted](../events/memory.promoted.md): A fact was promoted to a shared layer with the name and time of the person
- [memory.promotion_rejected](../events/memory.promotion_rejected.md): A promotion was rejected
- [memory.promotion_requested](../events/memory.promotion_requested.md): A promotion to a shared layer was requested
- [memory.promotion_undone](../events/memory.promotion_undone.md): A promotion was undone
- [memory.removed](../events/memory.removed.md): Facts were removed from answers (kept in history)
- [memory.restored](../events/memory.restored.md): A fact came back from Trash or Archive
- [memory.upkeep_ran](../events/memory.upkeep_ran.md): An upkeep run finished (counts and cost only)
- [note.erased](../events/note.erased.md): A memory note was erased for good (ids only)
