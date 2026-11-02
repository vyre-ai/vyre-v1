-- The Campaigns product left Vyre, and with it the kind campaign.reply: its rows and any level a person set for it go.
DELETE FROM notifications_items WHERE kind = 'campaign.reply';
DELETE FROM notifications_kind_levels WHERE kind = 'campaign.reply';
