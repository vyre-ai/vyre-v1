export interface SignInPolicy { secondFactor: "off" | "required"; requireSso: boolean; allowPassword: boolean; allowGithub: boolean }
export interface SignInMethods { github: boolean; sso: readonly string[]; newMemberMfaEnrollment: boolean }
export const DEFAULT_SIGN_IN_POLICY: Readonly<SignInPolicy> = {secondFactor:"off",requireSso:false,allowPassword:true,allowGithub:true};
export function parseSignInPolicy(value:unknown):SignInPolicy {
 if(value===null||typeof value!=="object"||Array.isArray(value))throw new Error("The sign-in policy is unavailable.");
 const row=value as Record<string,unknown>;const next={...DEFAULT_SIGN_IN_POLICY};
 for(const key of ["requireSso","allowPassword","allowGithub"] as const){if(row[key]!==undefined){if(typeof row[key]!=="boolean")throw new Error("The sign-in policy is unavailable.");next[key]=row[key];}}
 if(row.secondFactor!==undefined){if(row.secondFactor!=="off"&&row.secondFactor!=="required")throw new Error("The sign-in policy is unavailable.");next.secondFactor=row.secondFactor;}
 return next;
}
