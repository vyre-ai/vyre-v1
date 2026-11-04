import test from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {Reviews,closeReviewImpact} from "../pages/Reviews.tsx";
import {ConsoleDataProvider} from "../shell/data.tsx";
import {createSampleConsole} from "../shell/sample.ts";
const review={id:"rvw_fixture",state:"open" as const,openedAt:1700000000000,items:3,decided:1};
function draw(initialId?:string):string{const base=createSampleConsole().data;const rows:Record<string,unknown>={"access.reviews.list":{reviews:[review]},"access.reviews.get":{review,items:[]}};return renderToStaticMarkup(<ConsoleDataProvider value={{...base,screens:{...base.screens,capQuery:(cap:string)=>{const state={status:"ready",data:rows[cap]};return{subscribe:()=>()=>undefined,getSnapshot:()=>state};}} as never}}><Reviews {...(initialId?{initialId}:{})}/></ConsoleDataProvider>);}
test("access review list provides shared search/filter/selection and actual start control",()=>{const html=draw();for(const text of ["reviews-list","Search","review-start-open","1 of 3 grants decided"])assert.ok(html.includes(text),text);assert.doesNotMatch(html,/rvw_fixture<\/|not implemented|opens here/);});
test("review deep link uses standard object tabs and an impact-confirmed close",()=>{const html=draw(review.id);for(const text of ["review-object","Overview","Access","Activity","Grants","Review tasks","object-more"])assert.ok(html.includes(text),text);assert.match(closeReviewImpact(review),/2 undecided grants/);assert.match(closeReviewImpact(review),/access stays unchanged/);});
