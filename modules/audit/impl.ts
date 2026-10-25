// Audit module (lane L7a). The host loads these handlers once the manifest status is live (ARCH 12.4).
// Host seams the live boot must give each call's ctx (AuditSeams): `signer` (the Space checkpoint key), `archive` (the encrypted year files) and `exports` (Files).
// `appendRow` is what the invoke pipeline calls for an audited act, with `classOfInvoke` mapping its allow, deny or hold row to an audit class.
import { handlers } from "./handlers/index.ts";
import { appendRow, classOfInvoke } from "./projections.ts";

export { handlers, appendRow, classOfInvoke };
export const projections = {};
export const codecs = {};
