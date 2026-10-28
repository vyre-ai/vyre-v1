/** Private host port; never a capability input or generic transaction API. */
export interface RecoveryCommitInput {
  personId:string; username:string; oldVerifier:string; oldKeysJson:string; oldEpoch:number; oldTotpSecret:string|null;
  nonceHash:string; purpose:string;
  verifier:string; keysJson:string; epoch:number;
}
export type RecoveryCommit=(input:RecoveryCommitInput)=>{sessions:string[]}|null;
