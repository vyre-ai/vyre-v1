import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {AccessSnapshot,authorize,scopeFor,toSql,aclRows,evalPred} from "../src/authorize/index.ts";
test("legacy human Owner-group role grants are denied identically by authorize, predicate and SQL; ordinary group/Admin grants survive",()=>{
 const snap=new AccessSnapshot();snap.putPrincipal({id:"usr_peer",kind:"person",status:"active"});
 for(const [id,name] of [["rol_owner","Owner"],["rol_admin","Admin"],["rol_member","Member"]])snap.putRole({id:id!,name:name!,clearance:3,perms:["records.read"]});
 snap.addPrincipalRole({holder:"usr_peer",role:"rol_member"});snap.addPrincipalRole({holder:"grp_legacy",role:"rol_owner"});snap.addMember({group:"grp_legacy",member:"usr_peer"});
 const rows=[{id:"rec_owner",owner_id:"usr_else",label:0,holds:0},{id:"rec_group",owner_id:"usr_else",label:0,holds:0},{id:"rec_admin",owner_id:"usr_else",label:0,holds:0}];
 for(const row of rows)snap.putResource({id:row.id,type:"record",parent_id:null,label:0,owner_id:row.owner_id,holds:0});
 snap.putGrant({id:"gnt_owner",subject_kind:"role",subject_id:"rol_owner",resource_type:"record",resource_id:"rec_owner",level:"view"});
 snap.putGrant({id:"gnt_group",subject_kind:"group",subject_id:"grp_legacy",resource_type:"record",resource_id:"rec_group",level:"view"});
 snap.putGrant({id:"gnt_admin",subject_kind:"role",subject_id:"rol_admin",resource_type:"record",resource_id:"rec_admin",level:"view"});
 const check=(expected:string[])=>{const scope=scopeFor(snap,{principal:"usr_peer",entityType:"record",level:"view",perm:"records.read",now:1000});const db=new DatabaseSync(":memory:");try{db.exec("CREATE TABLE records (id TEXT,owner_id TEXT,label INTEGER,holds INTEGER); CREATE TABLE acl_index (person TEXT,entity_type TEXT,entity_id TEXT,level_rank INTEGER)");for(const row of rows)db.prepare("INSERT INTO records VALUES (?,?,?,?)").run(row.id,row.owner_id,row.label,row.holds);for(const row of aclRows(scope.predicate,"record"))db.prepare("INSERT INTO acl_index VALUES (?,?,?,?)").run(row.person,row.entity_type,row.entity_id,row.level_rank);const sql=toSql(scope.predicate);const selected=(db.prepare(`SELECT id FROM records WHERE ${sql.sql}`).all(...sql.params) as {id:string}[]).map(row=>row.id).sort();assert.deepEqual(selected,expected);for(const row of rows){const allowed=authorize(snap,{principal:"usr_peer",action:{perm:"records.read",level:"view"},resource:{type:"record",id:row.id},row,now:1000}).effect==="allow";assert.equal(allowed,expected.includes(row.id),row.id);assert.equal(evalPred(scope.predicate,row),allowed,row.id);}assert.ok(!snap.info("usr_peer")!.keys.has("role:rol_owner"));}finally{db.close();}};
 check(["rec_group"]);snap.addPrincipalRole({holder:"grp_legacy",role:"rol_admin"});check(["rec_admin","rec_group"]);
});
