-- The send window and caps left mail with cold email; they still govern texts, under telephony names. A value a Space chose keeps working. The throttle has no text half, so it goes.
UPDATE OR IGNORE settings_value SET setting = 'telephony.send_window' WHERE setting = 'mail.send_window';
UPDATE OR IGNORE settings_value SET setting = 'telephony.sender_caps' WHERE setting = 'mail.sender_caps';
UPDATE OR IGNORE settings_floor SET setting = 'telephony.send_window' WHERE setting = 'mail.send_window';
UPDATE OR IGNORE settings_floor SET setting = 'telephony.sender_caps' WHERE setting = 'mail.sender_caps';
DELETE FROM settings_value WHERE setting IN ('mail.send_window', 'mail.sender_caps', 'mail.throttle');
DELETE FROM settings_floor WHERE setting IN ('mail.send_window', 'mail.sender_caps', 'mail.throttle');
