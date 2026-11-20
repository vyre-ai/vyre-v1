-- esign: an envelope that ran out is told once (the event a Flow starts from, the sender's Needs you, the closed signature task). expired_told is 1 once that was done; envelopes that ran out before this column
-- existed count as told, so the first run does not announce old ones.

ALTER TABLE esign_envelope ADD COLUMN expired_told INTEGER NOT NULL DEFAULT 0;
UPDATE esign_envelope SET expired_told = 1 WHERE status = 'expired';
