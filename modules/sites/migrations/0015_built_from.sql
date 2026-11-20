-- Where a deploy's code came from (its source without the token), kept on its row: a preview promoted to production is judged by the source it was built from, not by the site's source today.
ALTER TABLE sites_deployment ADD COLUMN built_from TEXT;
