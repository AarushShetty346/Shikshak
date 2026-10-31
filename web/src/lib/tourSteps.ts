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

export const ALL_TOURS = () => [...HOME_TOUR, ...CLASS_TOUR, ...FOCUS_LINES, ...Object.values(INVIGILATOR_LINES)];

/** The home screen, the first time. */
export const HOME_TOUR: TourStep[] = [
  { title: "Namaste! I am Shikshak, your tutor", text: "Let me show you around. It takes one minute. You can press Next, or use the arrow keys." },
  { target: ".home-head-actions .btn-primary", title: "Start a class", text: "Press New session to start a class. Make one class for each chapter, like a notebook for every topic." },
  { target: ".group-entry", title: "Study with friends", text: "Start a study group and invite your friends. You each learn with your own tutor, and you can open each other's notes and progress." },
  { target: ".exam-entry", title: "Practice exams", text: "Take a practice exam in the board pattern. A mock exam gives you the paper; in an exam I watch like an invigilator. Then I mark your answer sheets like a board examiner." },
  { target: ".profile-button", title: "This is you", text: "Tap your picture to see your progress, switch to another learner, or add a brother or sister." },
  { target: ".session-list, .home-empty", title: "Your classes", text: "Your classes live here. Open one any time and the board is exactly as you left it." },
  { title: "That's it!", text: "Press New session, pick a topic, and I'll show you the board next." },
];

/** The classroom, the first time: what each control does, and how a class goes. */
export const CLASS_TOUR: TourStep[] = [
  { title: "This is our blackboard", text: "I teach on this board, and you write on it too. Let me show you the buttons." },
  { target: ".btn-start", title: "Start the class", text: "Press Play and I'll begin talking. Then just talk back to me, like a real class." },
  { target: ".btn-mic", title: "How to talk to me", text: "Once we start, I'm listening. Just talk to me, like a real class. Tap the mic to mute it, and press Stop if you want to cut me off." },
  { target: ".pen-fab", title: "Your pen", text: "Tap the pen for your tools: pen, eraser, scroll and undo. Write your working with your finger, mouse or stylus, one step on each line." },
  { target: ".dock-input input", title: "Rather type?", text: "No stylus? Type a step here and press Enter. Tap T for maths symbols like therefore and implies." },
  { target: "button.btn-done", title: "Press Done", text: "When you finish, press Done. I'll read your steps and circle the first one that went wrong." },
  { target: ".dock-attach", title: "Working in your notebook?", text: "Tap plus to send me a photo of your working or a question, or to upload your book. On a photo, press Fix it and I'll mark the slips and write the answer out." },
  { target: ".btn-speed", title: "My speed", text: "Am I too fast or too slow? Change how fast I talk." },
  { target: '[aria-label="Download notes as PDF"]', title: "Your notes", text: "Download the whole class as PDF notes, any time." },
  { target: '[aria-label="Session menu"]', title: "The menu", text: "Focus mode, your class report, a practice question and more are in here." },
  {
    title: "How we'll learn",
    text: "First I explain on the board. Then it's your turn to try. Press Done, and I check it and circle any slip. Stuck? Ask me for a hint. Ready? Press Play!",
  },
];

/** What the teacher says in focus mode when the student leaves the class, and when it's over. */
export const FOCUS_LINES: TourStep[] = [
  { title: "Eyes on the board", text: "Hello! Where did you go? Come back to the board, please." },
  { title: "Back to class", text: "Focus time is still on. Come back, we were doing so well." },
  { title: "Pay attention", text: "I saw you switch away. Let's get back to work together." },
  { title: "Well done!", text: "Your focus time is over. Take a short break, you've earned it." },
];

/** What the invigilator says out loud in an exam when the student leaves the paper. */
export const INVIGILATOR_LINES: Record<"left" | "window" | "fullscreen" | "share" | "camera" | "again", TourStep> = {
  left: { title: "Eyes on your paper", text: "You left the exam screen. Switching screens isn't allowed in the exam, and it has been noted. Please come back to your paper." },
  window: { title: "Stay on the exam", text: "You switched to another window. That's not allowed during the exam, and it has been noted. Back to your paper, please." },
  fullscreen: { title: "Back to fullscreen", text: "You left fullscreen. Please go back to fullscreen and carry on. This has been noted." },
  share: { title: "Screen sharing stopped", text: "Your screen sharing has stopped. Share your entire screen again to carry on with the exam." },
  camera: { title: "Camera is off", text: "Your camera has turned off. Turn it back on to carry on with the exam." },
  again: { title: "Another warning", text: "This is another warning. Every time you leave the exam, it goes in your report. Stay on your paper until you finish." },
};
