// The Type tool: for students who can't write with a stylus or finger. They type their working, one
// step per line, and it goes on the board as their own lines, where the teacher reads and checks it
// exactly like handwriting (Done, the circle on a wrong line, the eraser).

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";

/** Symbols a keyboard doesn't have, for writing steps the way an exam answer does. */
const SYMBOLS = ["=", "∴", "∵", "⇒", "≠", "±", "×", "÷", "√", "²", "³", "π", "θ", "°", "≤", "≥", "½"];

export function TypePanel({ onAdd, onClose }: { onAdd: (lines: string[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);

  const insert = (sym: string) => {
    const el = area.current;
    if (!el) return setText((t) => t + sym);
    const { selectionStart: a, selectionEnd: b } = el;
    const next = text.slice(0, a) + sym + text.slice(b);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(a + sym.length, a + sym.length);
    });
  };
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const add = () => {
    if (!lines.length) return;
    onAdd(lines.map((l) => l.slice(0, 120)));
    onClose();
  };

  return (
    <div className="type-panel" role="dialog" aria-label="Type your working" onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="type-panel-head">
        <span>Type your working, one step on each line</span>
        <button className="type-panel-close" onClick={onClose} aria-label="Close">
          <X weight="bold" />
        </button>
      </div>
      <textarea
        ref={area}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
        }}
        rows={4}
        maxLength={2000}
        placeholder={"x² − 5x + 6 = 0\n(x − 2)(x − 3) = 0\n∴ x = 2 or x = 3"}
        aria-label="Your working"
      />
      <div className="type-symbols" role="group" aria-label="Maths symbols">
        {SYMBOLS.map((s) => (
          <button key={s} type="button" onClick={() => insert(s)} aria-label={`Insert ${s}`}>
            {s}
          </button>
        ))}
      </div>
      <div className="type-panel-foot">
        <span className="type-panel-count">{lines.length ? `${lines.length} line${lines.length > 1 ? "s" : ""}` : ""}</span>
        <button className="btn-primary btn-small" onClick={add} disabled={!lines.length}>
          Put on the board
        </button>
      </div>
    </div>
  );
}
