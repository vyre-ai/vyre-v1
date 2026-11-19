-- Before this a variable's scope defaulted to all. A preview runs any branch's code, so a variable now applies to production unless a person scopes it wider; the ones kept so far were made when there were no previews.
UPDATE sites_env SET scope = 'production' WHERE scope = 'all';
