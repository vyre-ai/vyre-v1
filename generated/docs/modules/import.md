# Import (import)

Lane L3. Kind module. Status stub. Version 0.1.0.

Requires: schema.

## Capabilities (12)

- [import.commit](../capabilities/import.commit.md): Write the previewed rows as an import Run; no automations fire unless runAutomations is true
- [import.discard](../capabilities/import.discard.md): Drop a staged import before it is committed
- [import.get](../capabilities/import.get.md): Read one import: state, counts and the file of row errors
- [import.list](../capabilities/import.list.md): History of imports
- [import.parse_airtable](../capabilities/import.parse_airtable.md): Stage the tables of an Airtable base using a key held in the Vault
- [import.parse_csv](../capabilities/import.parse_csv.md): Stage a CSV or pasted CSV text and report its columns with inferred field types
- [import.parse_excel](../capabilities/import.parse_excel.md): Stage the sheets of an Excel file and report their columns
- [import.parse_google_sheets](../capabilities/import.parse_google_sheets.md): Stage the tabs of a Google Sheet the connected account can open
- [import.parse_notion](../capabilities/import.parse_notion.md): Stage a Notion database or an export file using a key held in the Vault
- [import.preview](../capabilities/import.preview.md): Preview an import: rows to create, update or skip, row errors, new fields, and a preview token
- [import.suggest_mapping](../capabilities/import.suggest_mapping.md): Suggest which column feeds which field of a record type, with a confidence for each
- [import.template](../capabilities/import.template.md): A CSV template for a record type: header row and one example row

## Events (3)

- [import.completed](../events/import.completed.md): An import finished
- [import.failed](../events/import.failed.md): An import stopped on an error; rows already written stay and the Run can be undone
- [import.started](../events/import.started.md): An import Run began writing rows
