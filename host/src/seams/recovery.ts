import type {RecoveryCommit} from "../../../packages/contracts/src/identity-recovery.ts";
import type {HostDb} from "../daemon/sqlite.ts";
import {sameMac} from "../../../kernel/src/seal/wire.ts";
/** Consume the proven challenge and replace the identity together, or change nothing. */
export function createRecoveryCommit(o:{db:Pick<HostDb,"all"|"run"|"tx">;now():number}):RecoveryCommit{
 const stale=new Error("recovery compare-and-swap refused");
 return input=>{try{return o.db.tx(()=>{
  const account=o.db.all("SELECT person_id, username, verifier, keys_json, epoch, totp_secret FROM identity_accounts WHERE person_id = ?",input.personId)[0] as {username:string;verifier:string;keys_json:string|null;epoch:number;totp_secret:string|null}|undefined;
  if(!account||account.username!==input.username||!sameMac(account.verifier,input.oldVerifier)||account.keys_json!==input.oldKeysJson||account.epoch!==input.oldEpoch||account.totp_secret!==input.oldTotpSecret)throw stale;
  const nonce=o.db.all("SELECT code_hash FROM identity_codes WHERE code_hash = ? AND kind = ? AND person_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?",input.nonceHash,"recovery",input.personId,input.purpose,o.now())[0];if(!nonce)throw stale;
  const used=o.db.run("UPDATE identity_codes SET used_at = ? WHERE code_hash = ? AND kind = ? AND person_id = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?",o.now(),input.nonceHash,"recovery",input.personId,input.purpose,o.now());if(used.changes!==1)throw stale;
  const changed=o.db.run("UPDATE identity_accounts SET verifier = ?, keys_json = ?, epoch = ?, recovery_hash = NULL, fails = 0, locked_until = 0 WHERE person_id = ? AND username = ? AND verifier = ? AND keys_json = ? AND epoch = ?",input.verifier,input.keysJson,input.epoch,input.personId,input.username,input.oldVerifier,input.oldKeysJson,input.oldEpoch);if(changed.changes!==1)throw stale;
  const sessions=(o.db.all("SELECT id FROM identity_sessions WHERE person_id = ? AND revoked_at IS NULL",input.personId) as {id:string}[]).map(row=>row.id);
  o.db.run("UPDATE identity_sessions SET revoked_at = ? WHERE person_id = ? AND revoked_at IS NULL",o.now(),input.personId);
  o.db.run("UPDATE devices_session SET revoked_at = ? WHERE person = ? AND kind = ? AND revoked_at IS NULL",o.now(),input.personId,"device");
  return{sessions};
 });}catch(error){if(error===stale)return null;throw error;}};
}
