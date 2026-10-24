# Search (search)

Lane L1. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (10)

- [search.actions.list](../capabilities/search.actions.list.md): Actions offered after the > prefix (New task, Call someone, Switch skin, Set yourself away, Go offline)
- [search.embed.run](../capabilities/search.embed.run.md): Embeddings consumer: compute pending vectors with the small local model (384 dimensions)
- [search.health](../capabilities/search.health.md): Search health: consumer lag and a probe query latency
- [search.index.apply](../capabilities/search.index.apply.md): Index consumer: apply one changed entity row to full text and vectors (durable cursor; never sees end-to-end rows)
- [search.index.rebuild](../capabilities/search.index.rebuild.md): Rebuild the index for an entity or the whole Space from the projections
- [search.index.stats](../capabilities/search.index.stats.md): Index size, consumer lag and vector backlog
- [search.query](../capabilities/search.query.md): Search everything the caller may see: people, agents, chats, inbox, records, files, automations, apps, settings, memory
- [search.recent.list](../capabilities/search.recent.list.md): Recent items before typing (opened and edited by the caller)
- [search.recent.record](../capabilities/search.recent.record.md): Note that the caller opened something so it shows under Recent
- [search.related](../capabilities/search.related.md): Items related to one item by links, relations and shared terms

## Events (1)

- [search.reindexed](../events/search.reindexed.md): The search index was rebuilt
