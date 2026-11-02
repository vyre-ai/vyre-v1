-- The Campaigns product left Vyre: a text no longer belongs to a campaign. The texts stay. A2P registration keeps its Twilio campaign sid: that is Twilio's word for a texting use case.
ALTER TABLE telephony_sms DROP COLUMN "campaignId";
