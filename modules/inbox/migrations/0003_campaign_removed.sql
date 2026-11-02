-- The Campaigns product left Vyre: a conversation no longer belongs to a campaign. Conversations and their messages stay.
ALTER TABLE inbox_conversation DROP COLUMN "campaignId";
ALTER TABLE inbox_item DROP COLUMN "campaignId";
