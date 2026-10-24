# Sources (sources)

Lane L3. Kind module. Status stub. Version 0.1.0.

Requires: nothing.

## Capabilities (17)

- [sources.create](../capabilities/sources.create.md): Set up a source: a connector source or a generic webhook with a mapping into a record type
- [sources.delete](../capabilities/sources.delete.md): Remove a source (records already created stay)
- [sources.deliveries.list](../capabilities/sources.deliveries.list.md): Delivery log of a source: status, provider id, error, records touched (payloads are not stored in the log)
- [sources.get](../capabilities/sources.get.md): Read one source with its mapping
- [sources.health](../capabilities/sources.health.md): Intake health: public address reachable, oldest unprocessed delivery, failing sources
- [sources.ingest](../capabilities/sources.ingest.md): Pipeline entry called by the public listener for /hooks/<source>: verify, dedupe on provider id, normalise, upsert, link
- [sources.kinds](../capabilities/sources.kinds.md): Source kinds a person can set up: connectors that declare sources plus the generic webhook
- [sources.link.list_pending](../capabilities/sources.link.list_pending.md): Unsure matches waiting for a person (they also arrive in Needs you)
- [sources.link.match](../capabilities/sources.link.match.md): The shared linking step: find a sure match or unsure candidates for a normalised row
- [sources.link.resolve](../capabilities/sources.link.resolve.md): Settle an unsure match: link to a candidate, create a new record, or ignore
- [sources.list](../capabilities/sources.list.md): List sources, optionally those feeding one record type (the Sources page on a record type)
- [sources.pause](../capabilities/sources.pause.md): Pause a source; deliveries are refused with a visible reason
- [sources.preview_mapping](../capabilities/sources.preview_mapping.md): Dry-run a mapping on a sample payload: the normalised row, create or update, and the linking outcome
- [sources.replay](../capabilities/sources.replay.md): Process a failed delivery again after fixing the mapping
- [sources.resume](../capabilities/sources.resume.md): Resume a paused source
- [sources.set_secret](../capabilities/sources.set_secret.md): Point a source at the Vault item holding its signing secret (name only, never the value)
- [sources.update](../capabilities/sources.update.md): Change the mapping, target type or verification of a source

## Events (11)

- [source.created](../events/source.created.md): A source was set up
- [source.deduped](../events/source.deduped.md): A delivery repeated a provider id already seen and was dropped
- [source.deleted](../events/source.deleted.md): A source was removed
- [source.link_pending](../events/source.link_pending.md): The linking step found only unsure matches and sent them to Needs you
- [source.linked](../events/source.linked.md): The linking step attached a delivery to an existing record (sure match or person-confirmed)
- [source.mapping_failed](../events/source.mapping_failed.md): A verified delivery could not be mapped to a record
- [source.paused](../events/source.paused.md): A source was paused; deliveries are refused with a visible reason
- [source.received](../events/source.received.md): An outside event arrived on /hooks/<source>, was verified and accepted
- [source.rejected](../events/source.rejected.md): A delivery failed verification (signature or secret) and was refused
- [source.resumed](../events/source.resumed.md): A paused source was resumed
- [source.updated](../events/source.updated.md): A source mapping or setting changed
