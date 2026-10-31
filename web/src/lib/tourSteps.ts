// What the guided tour says, step by step. Plain data (no React) so scripts/tour-voice.ts can
// record the same words in the tutor's voice.

export interface TourStep {
  /** CSS selector of the control to light up; none for a message in the middle of the screen. */
  target?: string;
  title: string;
  text: string;
}

/** What the teacher says out loud on a step: the title, then the text. */
export const spoken = (s: TourStep) => `${s.title}${/[.!?]$/.test(s.title) ? "" : "."} ${s.text}`;

/**
 * The recorded clip for a step, named by a hash of exactly what is said: change the words and the
 * old clip simply stops matching (the tour is silent on that step until it is recorded again).
 */
export function clipName(s: TourStep): string {
  let h = 0x811c9dc5;
  for (const ch of spoken(s)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `tour-${h.toString(16).padStart(8, "0")}.mp3`;
}

export const ALL_TOURS = () => [...HOME_TOUR, ...CLASS_TOUR];

/** The home screen, the first time. */
export const HOME_TOUR: TourStep[] = [
  { title: "Namaste! I am Shikshak, your tutor", text: "Let me show you around. It takes one minute. You can press Next, or use the arrow keys." },
  { target: ".mode-toggle", title: "Student or Teacher", text: "Learning? Stay on Student. Teachers switch here to see the progress students share with them." },
  { target: ".home-head-actions .btn-primary", title: "Start a class", text: "Press New session to start a class. Make one class for each chapter, like a notebook for every topic." },
  { target: ".profile-button", title: "This is you", text: "Tap your picture to see your progress, switch to another learner, or add a brother or sister." },
  { target: ".session-list, .home-empty", title: "Your classes", text: "Your classes live here. Open one any time and the board is exactly as you left it." },
  { title: "That's it!", text: "Press New session, pick a topic, and I'll show you the board next." },
];

/** The classroom, the first time: what each control does, and how a class goes. */
export const CLASS_TOUR: TourStep[] = [
  { title: "This is our blackboard", text: "I teach on this board, and you write on it too. Let me show you the buttons." },
  { target: ".btn-start", title: "Start the class", text: "Press Start and I'll begin talking. Then just talk back to me, like a real class." },
  { target: ".btn-start", title: "How to talk to me", text: "Hold the Talk button, or hold Space or Caps Lock, while you speak. Let go when you're done. Need to stop me? Press Stop." },
  { target: '[aria-label="Pen"]', title: "Your pen", text: "Write your working with your finger, mouse or stylus. One step on each line." },
  { target: '[aria-label="Eraser"]', title: "Rub it out", text: "Made a mistake? Use the eraser, or undo your last line." },
  { target: "button.btn-done", title: "Press Done", text: "When you finish, press Done. I'll read your steps and circle the first one that went wrong." },
  { target: '[aria-label="From paper"]', title: "Working in your notebook?", text: "No stylus? Solve it on paper and send me a photo. It goes on the board and I check it right there." },
  { target: '[aria-label="Upload material"]', title: "Your book", text: "Upload your textbook or notes, and I'll teach from your own pages." },
  { target: ".btn-speed", title: "My speed", text: "Am I too fast or too slow? Change how fast I talk." },
  { target: '[aria-label="Session menu"]', title: "The menu", text: "Your class report, a practice question and more are in here." },
  {
    title: "How we'll learn",
    text: "First I explain on the board. Then it's your turn to try. Press Done, and I check it and circle any slip. Stuck? Ask me for a hint. Ready? Press Start!",
  },
];
