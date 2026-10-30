import { useEffect, useState } from "react";
import { Classroom } from "./components/Classroom";
import { Home } from "./components/Home";
import { Pilot } from "./components/Pilot";
import { Progress } from "./components/Progress";
import { ChalkFilter } from "./components/Chalk";
import { DusterWipe, TeacherGate, teacherUnlocked, type Mode } from "./components/ModeToggle";
import { TeacherView } from "./components/Teacher";
import { getSession, sessionFromHash } from "./lib/session";

type Route = { page: "home" } | { page: "class"; id: string } | { page: "progress"; learnerId: string } | { page: "teacher" } | { page: "pilot" };

function readRoute(): Route {
  const id = sessionFromHash();
  if (id && getSession(id)) return { page: "class", id };
  const l = /^#\/learner\/(l_[A-Za-z0-9_-]{8,30})$/.exec(location.hash);
  if (l) return { page: "progress", learnerId: l[1] };
  if (location.hash === "#/teacher") return { page: "teacher" };
  if (location.hash === "#/pilot") return { page: "pilot" };
  return { page: "home" };
}

/**
 * Pages live in the URL (#/s/ABC123, #/learner/l_..., #/teacher), so refresh and the back button
 * work. Classroom is keyed by session id: switching sessions unmounts the old one completely (its
 * call, socket and board state) before the new one mounts.
 */
export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const go = (hash: string) => {
    if (location.hash !== hash) location.hash = hash;
    setRoute(readRoute());
  };

  // Switching between student and teacher mode: the duster rubs the board clean, then the other
  // mode is written underneath.
  // Teacher mode asks for the access code first (once per tab), including when #/teacher is opened
  // directly.
  const [wipeTo, setWipeTo] = useState<Mode | null>(null);
  const [unlocked, setUnlocked] = useState(teacherUnlocked);
  const [asking, setAsking] = useState(false);
  const switchMode = (to: Mode) => {
    if (wipeTo) return; // one wipe at a time
    if (to === "teacher" && !unlocked) setAsking(true);
    else setWipeTo(to);
  };
  const wipe = wipeTo && <DusterWipe onCovered={() => go(wipeTo === "teacher" ? "#/teacher" : "#/")} onDone={() => setWipeTo(null)} />;
  const locked = route.page === "teacher" && !unlocked;
  const gate = (asking || locked) && (
    <TeacherGate
      onUnlock={() => {
        setUnlocked(true);
        setAsking(false);
        if (!locked) setWipeTo("teacher");
      }}
      onCancel={() => {
        setAsking(false);
        if (locked) go("#/");
      }}
    />
  );

  return (
    <>
      <ChalkFilter />
      {page()}
      {wipe}
      {gate}
    </>
  );

  function page() {
  switch (route.page) {
    case "class":
      return <Classroom key={route.id} sessionId={route.id} onHome={() => go("#/")} />;
    case "progress":
      return <Progress key={route.learnerId} learnerId={route.learnerId} onBack={() => go("#/")} />;
    case "teacher":
      if (locked) return <Home onOpen={(id) => go(`#/s/${id}`)} onProgress={(lid) => go(`#/learner/${lid}`)} onSwitchMode={switchMode} />;
      return <TeacherView onBack={() => go("#/")} onSwitchMode={switchMode} />;
    case "pilot":
      return <Pilot onBack={() => go("#/")} />;
    default:
      return <Home onOpen={(id) => go(`#/s/${id}`)} onProgress={(lid) => go(`#/learner/${lid}`)} onSwitchMode={switchMode} />;
  }
  }
}
