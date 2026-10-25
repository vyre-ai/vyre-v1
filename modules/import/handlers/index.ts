// Handler table of the import module: all 12 capabilities of manifests/import.ts. The five parsers and suggest_mapping are in parse.ts, preview in preview.ts, commit in commit.ts and the
// reads, discard and the CSV template in session.ts.
import { commit } from "./commit.ts";
import { parseAirtable, parseCsv, parseExcel, parseGoogleSheets, parseNotion, suggestMapping } from "./parse.ts";
import { preview } from "./preview.ts";
import { discard, get, list, template } from "./session.ts";

export const handlers = {
  "import.commit": commit,
  "import.discard": discard,
  "import.get": get,
  "import.list": list,
  "import.parse_airtable": parseAirtable,
  "import.parse_csv": parseCsv,
  "import.parse_excel": parseExcel,
  "import.parse_google_sheets": parseGoogleSheets,
  "import.parse_notion": parseNotion,
  "import.preview": preview,
  "import.suggest_mapping": suggestMapping,
  "import.template": template,
};
