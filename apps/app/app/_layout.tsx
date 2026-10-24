import { Slot } from "expo-router";
import Head from "expo-router/head";
import { bootScript } from "../src/startup/boot.ts";

export default function Layout() {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <script>{bootScript()}</script>
      </Head>
      <Slot />
    </>
  );
}
