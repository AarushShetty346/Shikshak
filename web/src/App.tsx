import { useEffect, useState } from "react";
import { Classroom } from "./components/Classroom";
import { Home } from "./components/Home";
import { Pilot } from "./components/Pilot";
import { Progress } from "./components/Progress";
import { ChalkFilter } from "./components/Chalk";
import { DusterWipe } from "./components/Duster";
import { Splash, splashDue } from "./components/Splash";
import { JoinGroup, StudyGroups } from "./components/StudyGroup";
import { getSession, sessionFromHash } from "./lib/session";
import { listLearners } from "./lib/learners";

type Route =
  | { page: "home" }
  | { page: "class"; id: string }
  | { page: "progress"; learnerId: string }
  | { page: "pilot" }
  | { page: "groups"; groupId: string | null }
  | { page: "join"; code: string };

function readRoute(): Route {
  const id = sessionFromHash();
  if (id && getSession(id)) return { page: "class", id };
  const l = /^#\/learner\/(l_[A-Za-z0-9_-]{8,30})$/.exec(location.hash);
  if (l) return { page: "progress", learnerId: l[1] };
  const grp = /^#\/group(?:\/(grp_[A-Za-z0-9_-]{10,30}))?$/.exec(location.hash);
  if (grp) return { page: "groups", groupId: grp[1] ?? null };
  const join = /^#\/join\/([A-Za-z0-9]{6})$/.exec(location.hash);
  if (join) return { page: "join", code: join[1].toUpperCase() };
  if (location.hash === "#/pilot") return { page: "pilot" };
  return { page: "home" };
}

/**
 * Pages live in the URL (#/s/ABC123, #/learner/l_..., #/group), so refresh and the back button
 * work. Classroom is keyed by session id: switching sessions unmounts the old one completely (its
 * call, socket and board state) before the new one mounts.
 */
export function App() {
  const [route, setRoute] = useState<Route>(readRoute);
  // The start screen first (each visit); from there, a new device makes its account.
  const [splash, setSplash] = useState(() => splashDue() && readRoute().page === "home");

  // Fetch the accounts while the start screen shows, so home opens on the right one at once.
  useEffect(() => {
    void listLearners().catch(() => {});
  }, []);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (hash: string) => {
    if (location.hash !== hash) location.hash = hash;
    setRoute(readRoute());
  };

  // A new session: the duster rubs the board clean, then the new class is written underneath.
  const [wipeTo, setWipeTo] = useState<string | null>(null);
  const wipe = wipeTo && <DusterWipe onCovered={() => go(wipeTo)} onDone={() => setWipeTo(null)} />;
  const open = (id: string, fresh?: boolean) => (fresh ? setWipeTo(`#/s/${id}`) : go(`#/s/${id}`));

  if (splash && route.page === "home")
    return (
      <>
        <ChalkFilter />
        <Splash
          onStart={() => {
            setSplash(false);
          }}
        />
      </>
    );

  return (
    <>
      <ChalkFilter />
      {page()}
      {wipe}
    </>
  );

  function page() {
  switch (route.page) {
    case "class":
      return <Classroom key={route.id} sessionId={route.id} onHome={() => go("#/")} />;
    case "progress":
      return <Progress key={route.learnerId} learnerId={route.learnerId} onBack={() => go("#/")} />;
    case "groups":
      return <StudyGroups groupId={route.groupId} onBack={() => go("#/")} onOpenGroup={(id) => go(id ? `#/group/${id}` : "#/group")} />;
    case "join":
      return <JoinGroup code={route.code} onJoined={(id) => go(`#/group/${id}`)} onNotNow={() => go("#/")} />;
    case "pilot":
      return <Pilot onBack={() => go("#/")} />;
    default:
      return <Home onOpen={open} onProgress={(lid) => go(`#/learner/${lid}`)} />;
  }
  }
}
