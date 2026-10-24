# Logs and traces (logs)

Lane L7b. Kind module. Version 0.1.0.

Requires: nothing.

## Capabilities (10)

- [logs.client_upload](../capabilities/logs.client_upload.md): Upload the device ring-buffer log keyed by trace id (queued while offline, sent on reconnect)
- [logs.export](../capabilities/logs.export.md): Export a log search as a file
- [logs.query](../capabilities/logs.query.md): Search logs by person, agent, place, record, run or trace (ids and metadata only)
- [logs.replay_get](../capabilities/logs.replay_get.md): Result of a replay: steps, recorded outward calls, differences from the original
- [logs.replay_start](../capabilities/logs.replay_start.md): Replay a failed Run or sync conflict on a copy of the Space with outward capabilities stubbed and sealed values replaced
- [logs.settings_get](../capabilities/logs.settings_get.md): Logging settings: levels, retention windows, review sampling
- [logs.settings_set](../capabilities/logs.settings_set.md): Change logging settings
- [logs.spans](../capabilities/logs.spans.md): Spans of a trace or of a budget id for the speed page
- [logs.tail](../capabilities/logs.tail.md): Live tail of logs (stream opens over the live connection)
- [logs.trace](../capabilities/logs.trace.md): Trace view: logs, spans and events joined by one trace id

## Events (4)

- [client_log.uploaded](../events/client_log.uploaded.md): A device uploaded its ring-buffer log on reconnect
- [log.accessed](../events/log.accessed.md): Someone read logs (reading logs is itself audited)
- [replay.finished](../events/replay.finished.md): A replay sandbox finished; outward calls were recorded, never executed
- [replay.started](../events/replay.started.md): A replay sandbox started on a copy of the Space
