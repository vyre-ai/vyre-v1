-- git: the only state the module keeps itself. History, branches and remotes live in the repository at data/trees/<folderId>.
-- git_protection holds the protected-branch list of one folder (git.protect); a folder without a row uses the Space setting git.protected_branches.

CREATE TABLE IF NOT EXISTS git_protection (
  folder_id TEXT PRIMARY KEY,
  branches TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
