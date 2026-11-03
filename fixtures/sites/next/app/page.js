export const dynamic = "force-dynamic";
export default function Page() { return <h1>next-fixture-ok {process.env.GREETING ?? "no-greeting"}</h1>; }
