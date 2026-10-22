import { useEffect, useRef, useState } from "react";
import { MathText } from "./MathText";

export interface BoardBlock {
  id: string;
  title: string;
  steps: string[];
  /** Replayed blocks show at once; new ones are "written" step by step. */
  instant: boolean;
}

const STEP_DELAY_MS = 1500;

function Block({ block }: { block: BoardBlock }) {
  const [shown, setShown] = useState(block.instant ? block.steps.length : 0);

  useEffect(() => {
    if (shown >= block.steps.length) return;
    const t = setTimeout(() => setShown((n) => n + 1), shown === 0 ? 250 : STEP_DELAY_MS);
    return () => clearTimeout(t);
  }, [shown, block.steps.length]);

  return (
    <section className="chalk-block">
      {block.title && <h3 className="chalk-title">{block.title}</h3>}
      <ol className="chalk-steps">
        {block.steps.slice(0, shown).map((s, i) => (
          <li key={i} className={block.instant ? "" : "chalk-write"}>
            <MathText text={s} />
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Chalkboard({ blocks, wipeKey }: { blocks: BoardBlock[]; wipeKey: number }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Follow the writing as it appears.
    const id = setInterval(() => el.scrollTo({ top: el.scrollHeight, behavior: "smooth" }), 400);
    return () => clearInterval(id);
  }, [blocks.length]);

  return (
    <div className="chalkboard" key={wipeKey}>
      <div className="chalk-scroll" ref={scrollRef}>
        {blocks.length === 0 ? (
          <div className="chalk-empty">
            <p>The board is ready.</p>
            <p className="chalk-empty-sub">Your teacher writes here while explaining.</p>
          </div>
        ) : (
          blocks.map((b) => <Block key={b.id} block={b} />)
        )}
      </div>
      <div className="chalk-ledge" aria-hidden="true">
        <span className="chalk-piece" />
        <span className="duster" />
      </div>
    </div>
  );
}
