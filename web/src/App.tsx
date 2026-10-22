import { useEffect, useState } from "react";
import { Classroom } from "./components/Classroom";
import { Home } from "./components/Home";
import { getSession, sessionFromHash } from "./lib/session";

/**
 * Home <-> one session at a time. The open session lives in the URL (#/s/ABC123), so refresh and
 * the back button work. Classroom is keyed by session id: switching sessions unmounts the old one
 * completely (its call, socket and board state) before the new one mounts.
 */
export function App() {
  const [open, setOpen] = useState<string | null>(() => {
    const id = sessionFromHash();
    return id && getSession(id) ? id : null;
  });

  useEffect(() => {
    const onHash = () => {
      const id = sessionFromHash();
      setOpen(id && getSession(id) ? id : null);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (id: string | null) => {
    const hash = id ? `#/s/${id}` : "#/";
    if (location.hash !== hash) location.hash = hash;
    setOpen(id);
  };

  return open ? <Classroom key={open} sessionId={open} onHome={() => go(null)} /> : <Home onOpen={(id) => go(id)} />;
}
