import type {IdentityCtx,Account,Method} from "./projections.ts";
import {DEFAULT_SIGN_IN_POLICY} from "../../lib/sign-in-policy.ts";
import {fail} from "../../host/src/routes/errors.ts";
export function currentSignInPolicy(ctx:IdentityCtx){
 if(ctx.signInPolicy)return ctx.signInPolicy.current();
 const row=ctx.db.all("SELECT second_factor_required FROM identity_space WHERE id = ?",ctx.space)[0] as {second_factor_required:number}|undefined;
 return {...DEFAULT_SIGN_IN_POLICY,secondFactor:row?.second_factor_required===1?"required" as const:"off" as const};
}
export function assertSignInPolicy(ctx:IdentityCtx,account:Account,method:Method):void{
 const policy=currentSignInPolicy(ctx);
 if((method==="password"&&!policy.allowPassword)||(method==="github"&&(!policy.allowGithub||!ctx.github))||((method==="password"||method==="github")&&policy.requireSso))throw fail("auth.bad_credentials",ctx.trace.traceId);
 if(policy.secondFactor==="required"&&!account.totp_secret)throw fail("validation.precondition_failed",ctx.trace.traceId,{message:"This Space requires an authenticator. Ask the Space owner to help you enroll before signing in."});
}
export function assertNewMemberPolicy(ctx:IdentityCtx):void{
 const policy=currentSignInPolicy(ctx);
 if(!policy.allowPassword||policy.requireSso)throw fail("validation.precondition_failed",ctx.trace.traceId,{message:"Password account creation is disabled by this Space. The invite has not been accepted. Ask the Space owner for a supported way to join."});
 if(policy.secondFactor==="required"&&!ctx.signInPolicy?.methods.newMemberMfaEnrollment)throw fail("validation.precondition_failed",ctx.trace.traceId,{message:"This Space requires an authenticator enrollment flow that this server cannot offer for new members yet. The invite has not been accepted. Ask the Space owner to review the sign-in policy."});
}
