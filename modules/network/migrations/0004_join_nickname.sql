-- The name a person gave a server when they made its join code ("home-box"). The computer arrives under it instead of its host name.
ALTER TABLE network_join ADD COLUMN nickname TEXT;
