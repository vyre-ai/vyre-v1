-- When a schedule was first armed (the Automation turned on with it): the first scheduled Run's "previous" time, so a list step asks for what is new since then, not the app's whole history.
ALTER TABLE "automations_schedule_state" ADD COLUMN "armed_at" INTEGER;
