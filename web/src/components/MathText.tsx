import { toMathParts } from "../../../shared/mathText";

export function MathText({ text }: { text: string }) {
  return (
    <>
      {toMathParts(text).map((p, i) => (p.sup ? <sup key={i}>{p.text}</sup> : p.sub ? <sub key={i}>{p.text}</sub> : <span key={i}>{p.text}</span>))}
    </>
  );
}
