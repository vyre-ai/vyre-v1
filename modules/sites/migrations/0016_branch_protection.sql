-- What a person last found out about the production branch on the host (GitHub): {state: protected|open|unknown, branch, at}. A deploy by anything but a person, on a site whose production env holds Vault keys, waits for a person unless the branch is protected.
ALTER TABLE sites_site ADD COLUMN protection TEXT;
