// The Vault items that hold a whole company's keys: the delegation key that can act as any member, and the sign-in app's secret. The server uses them through the Vault port and a person pastes them in; no model
// and no process a model drives ever gets one. Named here so the Vault, the connectors and the flow agree on what these are.
export const GOOGLE_KEY_HANDLE = "#Google_DWD";
export const MICROSOFT_KEY_HANDLE = "#Microsoft_App";

const COMPANY_KEY = /^#?(google_dwd|microsoft_app|sso_(google|microsoft|okta)[a-z0-9_]*)(\.[a-z0-9_]+)?$/i;

export const isCompanyKey = (handle: string): boolean => COMPANY_KEY.test(handle);
