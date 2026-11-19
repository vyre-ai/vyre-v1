-- the four steps of a deploy (fetch, build, start, check): each one's state, when it began, how long it took and the line of the log where its lines begin, as JSON beside the log.
-- { "d": lines left out of the front of the kept log, "s": [{ "k": step, "s": state, "at": ms, "ms": took, "line": first line }] }. A deploy from before this has none.
ALTER TABLE sites_deployment ADD COLUMN steps TEXT;
