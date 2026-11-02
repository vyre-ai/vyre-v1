-- Connect your company: which data the company chose, who left the directory, and who reached a mailbox for whom.
ALTER TABLE microsoft_config ADD COLUMN "dataMail" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE microsoft_config ADD COLUMN "dataCalendar" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE microsoft_config ADD COLUMN "dataFiles" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE microsoft_member ADD COLUMN "directoryGone" INTEGER NOT NULL DEFAULT 0;
-- actor is who made the call (a person or an agent); onBehalf is the person an agent worked for; subject is the mailbox reached.
ALTER TABLE microsoft_read_log ADD COLUMN "onBehalf" TEXT;
-- The app's object id in the tenant, read from its own token: the Exchange scope step names it, so an admin never has to look it up.
ALTER TABLE microsoft_config ADD COLUMN "servicePrincipalId" TEXT;
