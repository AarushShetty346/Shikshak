// A graph the tutor drew with sliders (e.g. y = ax² + bx + c with a, b, c): the student moves a
// slider and the curve, its equation and where it crosses the x-axis change as they drag.
// The board's ink layer sits on top, so Board passes drags on a [data-board-drag] slider through.

import { useState } from "react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import type { Diagram } from "../../../shared/diagram";
import { DiagramView } from "./DiagramView";

type Graph = Extract<Diagram, { type: "graph" }>;

export function EditableGraph({ diagram, width, shown }: { diagram: Graph; width: number; shown: number }) {
  const params = diagram.params ?? [];
  const start = () => Object.fromEntries(params.map((q) => [q.name, q.value]));
  const [values, setValues] = useState<Record<string, number>>(start);
  const moved = params.some((q) => values[q.name] !== q.value);
  return (
    <div className="editable-graph">
      <DiagramView diagram={diagram} width={width} shown={shown} values={values} />
      <div className="graph-sliders">
        {params.map((q) => {
          const step = q.max - q.min > 20 ? 1 : 0.5;
          return (
            <label key={q.name} className="graph-slider">
              <span className="graph-slider-name">{q.name}</span>
              <input
                type="range"
                data-board-drag
                min={q.min}
                max={q.max}
                step={step}
                value={values[q.name]}
                onChange={(e) => setValues((v) => ({ ...v, [q.name]: Number(e.target.value) }))}
                aria-label={`Change ${q.name}`}
              />
              <span className="graph-slider-value">{String(values[q.name]).replace("-", "−")}</span>
            </label>
          );
        })}
        {moved && (
          <button className="graph-reset" data-board-action onClick={() => setValues(start())}>
            <ArrowCounterClockwise weight="bold" /> Reset
          </button>
        )}
      </div>
    </div>
  );
}
