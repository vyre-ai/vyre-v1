Exporting a connector writes its files with one `files.create_many` call for each folder instead of one call for each file: one commit and one update of who may see what for 50 or more files, so the export no longer grows with the number of actions on a big Space. `files.create_many` takes up to 200 files for one folder, all or none, and refuses a folder under Review changes (add an agent's files there one at a time).

Sharing keeps the rows of one rebuild in one transaction, not a commit for each row, so adding a file costs the same on a big Space as on a small one.

Files an agent makes with `files.create_many` carry the made-for-me stamp, like `files.create`. A string written to a name such as report.pdf or data.xlsx stays a text file (its kind comes from the content). A file's first version is indexed for search when the creation has not already indexed it. One `files.create_many` call may hold up to 25 MB of content.
