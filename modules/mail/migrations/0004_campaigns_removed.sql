-- The Campaigns product left Vyre (owner, 2 Nov 2026): regular email is an Automation, and cold email is not something Vyre does. The module's folder is gone, so nothing else can clean its tables.
-- Migrations run once per Space, module by module. On a Space that had Campaigns the tables are there; on a new Space they never were, so campaigns_unsub is declared here to give the copy below
-- something to read. Links in email already sent must keep working for as long as the mail sits in an inbox, so their tokens move to mail_unsub before anything is dropped. A used link stays used.

CREATE TABLE IF NOT EXISTS campaigns_unsub (token_hash TEXT PRIMARY KEY, campaign_id TEXT NOT NULL, member_id TEXT NOT NULL, address TEXT NOT NULL, used_at INTEGER);
INSERT OR IGNORE INTO mail_unsub (token_hash, address, used_at) SELECT token_hash, address, used_at FROM campaigns_unsub;

DROP TABLE campaigns_unsub;
DROP TABLE IF EXISTS campaigns_setting;
DROP TABLE IF EXISTS campaigns_warmup;
DROP TABLE IF EXISTS campaigns_reply;
DROP TABLE IF EXISTS campaigns_send;
DROP TABLE IF EXISTS campaigns_member;
DROP TABLE IF EXISTS campaigns_variant;
DROP TABLE IF EXISTS campaigns_step;
DROP TABLE IF EXISTS campaigns_campaign;

-- the counters behind per-mailbox caps and throttling, which went with it
DROP TABLE IF EXISTS mail_send_log;

ALTER TABLE mail_message DROP COLUMN "campaignId";
