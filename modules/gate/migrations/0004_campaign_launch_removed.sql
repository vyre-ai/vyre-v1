-- The Campaigns product left Vyre: a launch still waiting for approval has nothing left to release, so it expires.
UPDATE gate_holds SET state = 'expired' WHERE act = 'campaign_launch' AND state = 'held';
