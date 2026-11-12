-- Runs as: the person whose yes a Space automation's agent work runs on. Set when a person turns it on, publishes a change to it while it is on, or puts it on the Space; nobody else's edit carries it.
ALTER TABLE "automations_defs" ADD COLUMN "runs_as" TEXT;
