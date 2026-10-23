import { useEffect, useState } from "react";
import { Classroom } from "./components/Classroom";
import { Home } from "./components/Home";
import { Pilot } from "./components/Pilot";
import { Progress } from "./components/Progress";
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

  switch (route.page) {
    case "class":
      return <Classroom key={route.id} sessionId={route.id} onHome={() => go("#/")} />;
    case "progress":
      return <Progress key={route.learnerId} learnerId={route.learnerId} onBack={() => go("#/")} />;
    case "teacher":
      return <TeacherView onBack={() => go("#/")} />;
    case "pilot":
      return <Pilot onBack={() => go("#/")} />;
    default:
      return <Home onOpen={(id) => go(`#/s/${id}`)} onProgress={(lid) => go(`#/learner/${lid}`)} />;
  }
}
