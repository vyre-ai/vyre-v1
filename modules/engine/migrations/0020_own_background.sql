-- The subagents and jobs a command-line engine starts in the BACKGROUND (owner's rc.28 report, 16 Nov): the launch call only says it started; the helper works on after the turn that started it ended.
-- `background` marks such a row (it is not settled when its turn ends, only when its own end comes), `task_id` is the engine's own id for it (its later lines name it), and `step` is what it is doing now, in words,
-- kept because no live turn carries it any more.
ALTER TABLE engine_own_subagent ADD COLUMN background INTEGER NOT NULL DEFAULT 0;
ALTER TABLE engine_own_subagent ADD COLUMN task_id TEXT;
ALTER TABLE engine_own_subagent ADD COLUMN step TEXT;
