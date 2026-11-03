// Install Vyre on an Android phone (owner decision D18, 3 Nov 2026): the phone app is the web app installed from Chrome. When Chrome offers the install and the app is not installed yet,
// the You screen shows one row; pressing it opens Chrome's own install dialog. Nothing shows on iPhone, in an installed app, or on a computer.
import { useEffect, useState } from "react";
import type { ReactElement } from "react";
import { Row } from "../../../../../ui/src/Row/index.tsx";
import { canInstall, onInstallChange, promptInstall } from "../../startup/install.ts";

export const INSTALL_TITLE = "Install Vyre";
export const INSTALL_NOTE = "Add it to your home screen";

export function InstallRow({ offered = canInstall }: { /** Tests pass their own answer. */ offered?: () => boolean }): ReactElement | null {
  const [show, setShow] = useState(offered);
  useEffect(() => onInstallChange(() => setShow(offered())), [offered]);
  if (!show) return null;
  return <Row id="you-install" title={INSTALL_TITLE} note={INSTALL_NOTE} onPress={() => { void promptInstall().then(() => setShow(offered()), () => setShow(offered())); }} />;
}
