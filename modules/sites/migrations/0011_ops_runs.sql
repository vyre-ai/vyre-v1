-- the container a job run is in, so a server restart finds a run that is still going instead of calling it lost
ALTER TABLE sites_job_run ADD COLUMN container_id TEXT;
