import test from 'node:test';
import assert from 'node:assert/strict';
import {AccessSnapshot} from '../../kernel/src/authorize/index.ts';
import {formUploadAllowed} from '../src/daemon/forms-authority.ts';
function fixture(){
 const snapshot=new AccessSnapshot();snapshot.putPrincipal({id:'usr_publisher',kind:'person',status:'active'});snapshot.putRole({id:'role_publisher',clearance:9,perms:['forms.publish','files.write']});snapshot.addPrincipalRole({holder:'usr_publisher',role:'role_publisher'});
 for(const [id,type] of [['frm_fixture','form'],['fld_fixture','folder']] as const)snapshot.putResource({id,type,parent_id:null,label:0,owner_id:'usr_publisher',holds:0});
 return {snapshot,input:{publisherId:'usr_publisher',formId:'frm_fixture',folderId:'fld_fixture',liveLocalFolder:true,stale:false,now:100}};
}
test('upload authority requires both form permission and folder write permission on a live local folder',()=>{
 const {snapshot,input}=fixture();assert.equal(formUploadAllowed(snapshot,input),true);
 snapshot.putRole({id:'role_publisher',clearance:9,perms:['forms.publish']});assert.equal(formUploadAllowed(snapshot,input),false);
 snapshot.putRole({id:'role_publisher',clearance:9,perms:['files.write']});assert.equal(formUploadAllowed(snapshot,input),false);
});
test('suspension, removal, deleted folders, cross-Space folder IDs and stale access all refuse uploads',()=>{
 const {snapshot,input}=fixture();
 for(const status of ['suspended','removed'] as const){snapshot.putPrincipal({id:'usr_publisher',kind:'person',status});assert.equal(formUploadAllowed(snapshot,input),false);}
 snapshot.putPrincipal({id:'usr_publisher',kind:'person',status:'active'});
 assert.equal(formUploadAllowed(snapshot,{...input,liveLocalFolder:false}),false);
 assert.equal(formUploadAllowed(snapshot,{...input,folderId:'fld_other_space',liveLocalFolder:false}),false);
 assert.equal(formUploadAllowed(snapshot,{...input,stale:true}),false);
});
