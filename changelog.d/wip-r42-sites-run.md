A site's Logs and Overview numbers are kept: its app output, requests and build log can be searched and followed live, and CPU, memory and response time are measured a minute at a time.
A site can have scheduled jobs and workers: a command in its own image runs on a schedule with a history, or stays up and restarts itself when it crashes; its database can be backed up and put back.
Putting a backup back never loses data: the live database is backed up first and kept seven days, the dump loads into a new database, and it is swapped in only when that worked.
