// P-L8_19: the public form pages answer on a real booted daemon. The owner makes and publishes a form through the gateway, then a signed-out visitor (no token) reads GET /f/<slug>, is
// refused a draft with the same 404 as a form that never existed, and posts to /f/submit: an answer to a question the form's logic hides is dropped before the record is written.
// Path mapping: the packet owns host/src/routes/forms-page.ts; this test sits in host/tests because it boots the daemon.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fakePlatform } from "../src/platform/index.ts";
import type { FetchFn } from "../src/platform/probes.ts";
import { loadConfig } from "../src/daemon/config.ts";
import { startDaemon } from "../src/daemon/daemon.ts";
import type { Daemon } from "../src/daemon/daemon.ts";

const caddyFetch: FetchFn = () => Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('{"apps":{"http":{}}}') });
const RECORD_TYPE = "rt_lead";
const KEYS = { personKeyByPassword: "cGVyc29uLWJ5LXBhc3N3b3Jk", publicKey: "cHVibGljLWtleQ==", privateKeyWrapped: "cHJpdmF0ZS13cmFwcGVk", spaceKeys: [{ epoch: 1, wrapped: "c3BhY2Uta2V5LTE=" }] };
const PASSWORD = "correct horse battery staple 9";
const LEAD = {
  op: "type.create", type: RECORD_TYPE,
  def: { title: "Lead", plural: "Leads", icon: "user", titleField: "email", fields: ["email", "kind", "company_name", "resume"].map((key) => ({ key, type: "text", title: key })) },
};

/** A fresh Space the owner claims and signs in to (ruling 71), the way a person gets in; the returned token is a real session. */
async function boot(): Promise<{ d: Daemon; owner: string }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vyre-forms-page-"));
  const d = await startDaemon({
    config: loadConfig(["--data-dir", dir, "--port", "0", "--space", "spc_forms", "--space-name", "Forms Co", "--address", "team.example.com"], {}, "1.2.3"),
    platform: fakePlatform({
      os: "linux", hostname: "forms-page", free: 80e9,
      commands: {
        [`findmnt -n -o SOURCE --target ${dir}`]: { stdout: "/dev/mapper/vyre\n" },
        "lsblk -s -n -o TYPE /dev/mapper/vyre": { stdout: "crypt\ndisk\n" },
        "docker info --format {{.ServerVersion}}": { stdout: "27.1.1\n" },
      },
    }),
    fetch: caddyFetch,
    intervals: { fast: 3_600_000, slow: 3_600_000, encryption: 3_600_000, commands: 3_600_000, hooks: 3_600_000 },
  });
  const post = async (p: string, body: unknown, token?: string): Promise<{ status: number; json: { data?: any } }> => {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as { data?: any } };   // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const code = decodeURIComponent(new URL(d.claim!.url).pathname.split("/").pop() ?? "");
  const device = { deviceName: "Mac", deviceClass: "desktop" };
  const claimed = await post("/v1/identity/claim_owner", { code, spaceId: "spc_forms", username: "olivia", displayName: "Olivia", password: PASSWORD, ...device, keys: KEYS });
  assert.equal(claimed.status, 200, JSON.stringify(claimed.json));
  const signedIn = await post("/v1/identity/sign_in", { username: "olivia", password: PASSWORD, ...device });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.json));
  const owner = signedIn.json.data.session.token as string;
  const type = await post("/v1/schema/apply", { idempotencyKey: "forms-page-type", ops: [LEAD] }, owner);
  assert.equal(type.status, 200, JSON.stringify(type.json));
  return { d, owner };
}

async function call<T>(d: Daemon, owner: string, p: string, body: unknown, token: string | null = owner): Promise<{ status: number; data?: T; error?: { code: string; details?: { field?: string } } }> {
  const r = await fetch(`${d.url}${p}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  const j = (await r.json()) as { data?: T; error?: { code: string; details?: { field?: string } } };
  return { status: r.status, ...j };
}

async function makeForm(d: Daemon, owner: string, name: string, publish: boolean): Promise<{ formId: string; slug: string }> {
  const made = await call<{ form: { formId: string; slug: string } }>(d, owner, "/v1/forms/create", { name, recordType: RECORD_TYPE, kind: "public", idempotencyKey: `forms-page-${name}` });
  assert.equal(made.status, 200, JSON.stringify(made));
  const { formId, slug } = made.data!.form;
  const fields = await call(d, owner, "/v1/forms/fields_set", { formId, fields: [{ field: "email", mode: "ask" }, { field: "kind", mode: "ask" }, { field: "company_name", mode: "ask" }, { field: "resume", mode: "ask" }] });
  assert.equal(fields.status, 200, JSON.stringify(fields));
  const tree = await call<{roots:{key:string;folderId?:string}[]}>(d,owner,"/v1/files/tree",{});
  const parent = tree.data!.roots.find((root)=>root.key==='projects')!.folderId!;
  const createdFolder = await call<{folder:{folderId:string}}>(d,owner,"/v1/files/folder/create",{parentId:parent,name:`${name} uploads`,idempotencyKey:`forms-page-folder-${name}`});
  assert.equal(createdFolder.status,200,JSON.stringify(createdFolder));
  const policy = await call(d, owner, "/v1/forms/update", { formId, uploadPolicy: { fields: ["resume"], folderId: createdFolder.data!.folder.folderId, maxBytes: 1_000_000 } });
  assert.equal(policy.status, 200, JSON.stringify(policy));
  const design = await call(d, owner, "/v1/forms/design_set", { formId, logic: { rules: [{ when: { field: "kind", op: "eq", value: "company" }, show: ["company_name"] }] } });
  assert.equal(design.status, 200, JSON.stringify(design));
  if (publish) assert.equal((await call(d, owner, "/v1/forms/publish", { formId })).status, 200);
  return { formId, slug };
}

test("a booted daemon serves a published form to a signed-out visitor, hides a draft, and drops a hidden question's answer at submit", async () => {
  const { d, owner } = await boot();
  try {
    const open = await makeForm(d, owner, "Page open", true);
    const draft = await makeForm(d, owner, "Page draft", false);

    const page = await fetch(`${d.url}/f/${open.slug}`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    const html = await page.text();
    assert.match(html, /<title>Page open<\/title>/);
    assert.match(html, /data-field="email"/);
    assert.match(html, /data-field="company_name"/);
    assert.match(html, /"logic":\{"rules":\[/, "the logic travels with the page so the browser can show and hide");

    for (const slug of [draft.slug, "no-such-form"]) {
      const r = await fetch(`${d.url}/f/${slug}`);
      assert.equal(r.status, 404, slug);
      assert.equal(((await r.json()) as { error: { code: string } }).error.code, "validation.not_found");
    }
    assert.equal((await fetch(`${d.url}/book/${open.slug}`)).status, 404, "a public form has no booking address");

    // the owner's gateway still works beside the page route
    assert.equal((await call(d, owner, "/v1/forms/list", {})).status, 200);

    const sent = await call<{ recordId: string }>(d, owner, "/f/submit", { slug: open.slug, idempotencyKey: "forms-page-submit-1", answers: { email: "visitor@x.example", kind: "person", company_name: "Hidden Co" } }, null);
    assert.equal(sent.status, 200, JSON.stringify(sent));
    const rec = await call<{ record: { fields: Record<string, unknown> } }>(d, owner, "/v1/records/get", { type: RECORD_TYPE, recordId: sent.data!.recordId });
    assert.equal(rec.status, 200, JSON.stringify(rec));
    assert.equal(rec.data!.record.fields["email"], "visitor@x.example");
    assert.equal(rec.data!.record.fields["kind"], "person");
    assert.equal(rec.data!.record.fields["company_name"], undefined, "the answer to a hidden question is never written");

    // a visitor cannot attach a file that already exists in the Space: a file answer must be an upload id this form issued to this visitor
    const stolen = await call(d, owner, "/f/submit", { slug: open.slug, idempotencyKey: "forms-page-submit-2", answers: { email: "thief@x.example", resume: { fileId: "fil_internal_secret" } } }, null);
    assert.equal(stolen.status, 422, JSON.stringify(stolen));
    assert.equal(stolen.error?.code, "validation.bad_input");
  } finally { await d.stop(); }
});

test('published typed form uses schema widgets and validates anonymous values before writing records',async()=>{
 const {d,owner}=await boot();
 try{
  const type='typed_public';
  const fields=[{key:'name',title:'Name',type:'text'},{key:'email',title:'Email',type:'email'},{key:'head_count',title:'Head count',type:'number'},{key:'active',title:'Active customer',type:'checkbox'},{key:'stage',title:'Sales stage',type:'choice',options:{choices:[{key:'new',title:'New lead'},{key:'done',title:'Completed'}]}},{key:'tags',title:'Tags',type:'multichoice',options:{choices:[{key:'a',title:'Alpha'},{key:'b',title:'Beta'}]}},{key:'appointment',title:'Appointment',type:'datetime'},{key:'score',title:'Satisfaction',type:'rating'},{key:'attachment',title:'Attachment',type:'files'}];
  const schema=await call(d,owner,'/v1/schema/apply',{idempotencyKey:'typed-public-schema',ops:[{op:'type.create',type,def:{title:'Typed lead',plural:'Typed leads',icon:'user',titleField:'name',fields}}]});assert.equal(schema.status,200,JSON.stringify(schema));
  const made=await call<{form:{formId:string;slug:string}}>(d,owner,'/v1/forms/create',{name:'Typed public',recordType:type,kind:'survey',idempotencyKey:'typed-public-form'});assert.equal(made.status,200,JSON.stringify(made));const {formId,slug}=made.data!.form;
  assert.equal((await call(d,owner,'/v1/forms/fields_set',{formId,fields:fields.map((field)=>({field:field.key,mode:'ask'}))})).status,200);
  const tree=await call<{roots:{key:string;folderId?:string}[]}>(d,owner,'/v1/files/tree',{});const parent=tree.data!.roots.find((root)=>root.key==='projects')!.folderId!;
  const folder=await call<{folder:{folderId:string}}>(d,owner,'/v1/files/folder/create',{parentId:parent,name:'Public upload fixture',idempotencyKey:'typed-public-folder'});assert.equal(folder.status,200,JSON.stringify(folder));
  const crossSpace = await call(d,owner,'/v1/forms/update',{formId,uploadPolicy:{fields:['attachment'],folderId:'fld_other_space'}});assert.equal(crossSpace.status,403,JSON.stringify(crossSpace));
  assert.equal((await call(d,owner,'/v1/forms/update',{formId,uploadPolicy:{fields:['attachment'],folderId:folder.data!.folder.folderId,maxBytes:1000,types:['text/plain']}})).status,200);
  assert.equal((await call(d,owner,'/v1/forms/publish',{formId})).status,200);
  const response=await fetch(`${d.url}/f/${slug}`);assert.equal(response.status,200);const html=await response.text();
  assert.match(html,/type="number" data-field="head_count"/);assert.match(html,/<select[^>]+data-field="active"/);assert.match(html,/<option value="new">New lead<\/option>/);assert.match(html,/data-field="tags" multiple/);assert.match(html,/type="datetime-local" data-field="appointment"/);assert.match(html,/data-field="score"[^>]*min="1" max="5"/);assert.match(html,/type="file" data-field="attachment"/);
  const answers={name:'Typed visitor',email:'typed@fixture.example',head_count:'12.5',active:'false',stage:'new',tags:['a','b'],appointment:'2026-10-28T12:00:00Z',score:'4'};
  for(const invalid of [{head_count:'bad'},{stage:'private'},{tags:['a','private']},{score:'8'},{appointment:'not-a-date'},{attachment:['fil_private']}]){const bad=await call(d,owner,'/f/submit',{slug,answers:{...answers,...invalid}},null);assert.equal(bad.status,422,JSON.stringify(bad));}
  const uploadResponse=await fetch(`${d.url}/f/upload/${slug}`,{method:'POST',headers:{'content-type':'text/plain','x-file-name':'fixture.txt'},body:'Fixture upload'});const upload=await uploadResponse.json() as {data?:{fileId:string}};assert.equal(uploadResponse.status,200,JSON.stringify(upload));
  const sent=await call<{recordId:string}>(d,owner,'/f/submit',{slug,answers:{...answers,attachment:{fileId:upload.data!.fileId}}},null);assert.equal(sent.status,200,JSON.stringify(sent));
  const record=await call<{record:{fields:Record<string,unknown>}}>(d,owner,'/v1/records/get',{type,recordId:sent.data!.recordId});assert.equal(record.status,200,JSON.stringify(record));assert.equal(record.data!.record.fields.head_count,12.5);assert.equal(record.data!.record.fields.active,false);assert.deepEqual(record.data!.record.fields.tags,['a','b']);assert.equal(record.data!.record.fields.score,4);assert.ok(Array.isArray(record.data!.record.fields.attachment));assert.match(String((record.data!.record.fields.attachment as string[])[0]),/^fil_/);
  assert.equal((await call(d,owner,'/v1/files/folder/delete',{folderId:folder.data!.folder.folderId})).status,200);
  const afterDelete=await fetch(`${d.url}/f/upload/${slug}`,{method:'POST',headers:{'content-type':'text/plain','x-file-name':'deleted.txt'},body:'Refused upload'});assert.ok([403,404].includes(afterDelete.status),await afterDelete.text());
 }finally{await d.stop();}
});

test('public relation guard never enumerates private records or accepts arbitrary record IDs; signed links preserve bound relations',async()=>{
 const {d,owner}=await boot();try{
  const company=await call<{record:{id:string}}>(d,owner,'/v1/records/create',{type:'company',fields:{name:'Private relation fixture'},idempotencyKey:'private-relation-company'});assert.equal(company.status,200,JSON.stringify(company));
  const companyId=company.data!.record.id;
  const made=await call<{form:{formId:string;slug:string}}>(d,owner,'/v1/forms/create',{name:'Guarded contact',recordType:'contact',kind:'public',idempotencyKey:'guarded-contact-form'});const {formId,slug}=made.data!.form;
  assert.equal((await call(d,owner,'/v1/forms/fields_set',{formId,fields:[{field:'name',mode:'ask'},{field:'email',mode:'ask'},{field:'company',mode:'ask'}]})).status,200);
  assert.equal((await call(d,owner,'/v1/forms/publish',{formId})).status,200);
  const page=await fetch(`${d.url}/f/${slug}`);assert.equal(page.status,200);const html=await page.text();assert.match(html,/publisher-approved record choices/);assert.ok(!html.includes(companyId));assert.ok(!html.includes('Private relation fixture'));
  for(const company of [companyId,'rec_other_space']){const refused=await call(d,owner,'/f/submit',{slug,answers:{name:'Visitor',email:'visitor@fixture.example',company}},null);assert.equal(refused.status,422,JSON.stringify(refused));assert.equal(refused.error?.details?.field,'answers.company');}
  const urn=`vyre://spc_forms/record/company/${companyId}`;
  const bound=await call<{record:{id:string}}>(d,owner,'/v1/records/create',{type:'contact',fields:{name:'Bound contact',company:[{urn}]},idempotencyKey:'bound-relation-contact'});assert.equal(bound.status,200,JSON.stringify(bound));
  const link=await call<{url:string}>(d,owner,'/v1/forms/link_create',{formId,recordId:bound.data!.record.id,singleUse:false,expiresInHours:1,idempotencyKey:'bound-relation-link'});assert.equal(link.status,200,JSON.stringify(link));const token=new URL(link.data!.url,'https://fixture.example').searchParams.get('t');assert.ok(token);
  const sent=await call(d,owner,'/f/submit',{slug,token,answers:{email:'bound@fixture.example'}},null);assert.equal(sent.status,200,JSON.stringify(sent));
  const saved=await call<{record:{fields:Record<string,unknown>}}>(d,owner,'/v1/records/get',{type:'contact',recordId:bound.data!.record.id});assert.deepEqual(saved.data!.record.fields.company,[{urn}]);
 }finally{await d.stop();}
});
