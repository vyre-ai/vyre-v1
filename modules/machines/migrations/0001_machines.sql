-- Machines (lane l-machines). One row per machine that reports (the Space server, an added server, a person's linked computer), the 1-minute points of its load, and the agents pinned to it.
-- Every statement is one CREATE: projections.ts runs the same list one by one when a table is missing, so a test ctx and the daemon end up with the same schema.

CREATE TABLE IF NOT EXISTS "machines_machine" (
  "machine_id" TEXT PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "owner_id" TEXT,
  "nickname" TEXT,
  "max_turns" INTEGER,
  "max_agent_computers" INTEGER,
  "drain" INTEGER NOT NULL DEFAULT 0,
  "specs" TEXT,
  "load" TEXT,
  "runs" TEXT,
  "can" TEXT,
  "vyre" TEXT,
  "version" TEXT,
  "latency_ms" INTEGER,
  "last_seen" INTEGER,
  "first_seen" INTEGER NOT NULL
);

-- One point per machine per bucket: res 1 is a minute (kept 24 hours), res 10 is ten minutes (kept 30 days). n is how many reports the average is of, so a later merge stays exact.
CREATE TABLE IF NOT EXISTS "machines_point" (
  "machine_id" TEXT NOT NULL,
  "res" INTEGER NOT NULL,
  "t" INTEGER NOT NULL,
  "n" INTEGER NOT NULL,
  "cpu" REAL,
  "mem" REAL,
  "disk" REAL,
  "nin" REAL,
  "nout" REAL,
  "vcpu" REAL,
  "vmem" REAL,
  PRIMARY KEY ("machine_id", "res", "t")
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS "machines_pin" (
  "machine_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "at" INTEGER NOT NULL,
  PRIMARY KEY ("machine_id", "agent_id")
);

CREATE TABLE IF NOT EXISTS "machines_meta" (
  "key" TEXT PRIMARY KEY,
  "value" TEXT NOT NULL
)
