import { useState } from "react";

// Structured deploy-log model. The API tags each streamed line with a level
// token (see deploy.processor.ts):
//   @stage <name> · @ok <name>|<time> · @fail <name>|<reason>
//   @info <text> · @debug <text> · (raw program output)
// We fold those into ordered, timed stage groups for a Netlify-style timeline.
// Shared by the live LogViewer (AppDetailPage) and the static error-analysis
// pages (dashboard ErrorDetailPage, admin Errors).

type StageState = "running" | "ok" | "failed";

interface LogLine {
  text: string;
  debug: boolean;
  ts?: string; // HH:MM:SS, derived from the @ts: prefix
}

interface LogStage {
  name: string;
  state: StageState;
  duration?: string;
  failReason?: string;
  ts?: string;
  body: LogLine[];
}

export interface ParsedLog {
  preamble: LogLine[];
  stages: LogStage[];
}

function fmtClock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function looksLikeBuildOutput(line: string): boolean {
  return (
    line.startsWith("Step ") ||
    line.startsWith("Sending build context") ||
    line.startsWith("Successfully built") ||
    line.startsWith("Successfully tagged")
  );
}

function splitTs(raw: string): { ts?: string; line: string } {
  if (raw.startsWith("@ts:")) {
    const sep = raw.indexOf("\x1f");
    if (sep !== -1) {
      const ms = Number(raw.slice(4, sep));
      return {
        ts: Number.isFinite(ms) ? fmtClock(ms) : undefined,
        line: raw.slice(sep + 1),
      };
    }
  }
  return { line: raw };
}

export function parseLog(rawLines: string[]): ParsedLog {
  const preamble: LogLine[] = [];
  const stages: LogStage[] = [];

  const pushBody = (text: string, debug: boolean, ts?: string) => {
    const cur = stages[stages.length - 1];
    if (cur) cur.body.push({ text, debug, ts });
    else preamble.push({ text, debug, ts });
  };
  const findStage = (name: string) =>
    [...stages].reverse().find((s) => s.name === name) ?? stages[stages.length - 1];

  for (const rawWithTs of rawLines) {
    const { ts, line: raw } = splitTs(rawWithTs);
    if (raw.startsWith("@stage ")) {
      stages.push({ name: raw.slice(7), state: "running", body: [], ts });
    } else if (raw.startsWith("@ok ")) {
      const [name, time] = raw.slice(4).split("|");
      const st = findStage(name);
      if (st) {
        st.state = "ok";
        st.duration = time;
      }
    } else if (raw.startsWith("@fail ")) {
      const [name, reason] = raw.slice(6).split("|");
      const st = findStage(name);
      if (st) {
        st.state = "failed";
        st.failReason = reason;
      }
    } else if (raw.startsWith("@info ")) {
      pushBody(raw.slice(6), false, ts);
    } else if (raw.startsWith("@debug ")) {
      pushBody(raw.slice(7), true, ts);
    } else {
      if (stages.length === 0 && looksLikeBuildOutput(raw)) {
        stages.push({ name: "Building", state: "running", body: [], ts });
      }
      const debug = raw.startsWith("[stderr]") || raw.startsWith("[debug");
      pushBody(raw, debug, ts);
    }
  }

  return { preamble, stages };
}

export function StageRow({ stage, showDebug }: { stage: LogStage; showDebug: boolean }) {
  // A finished (ok) stage collapses by default; running/failed stays open.
  // Once the user clicks, their choice wins.
  const [override, setOverride] = useState<boolean | null>(null);
  const autoOpen = stage.state !== "ok";
  const open = override ?? autoOpen;

  const visibleBody = stage.body.filter((b) => showDebug || !b.debug);
  const hasBody = visibleBody.length > 0 || (stage.state === "failed" && !!stage.failReason);

  const icon = stage.state === "ok" ? "✓" : stage.state === "failed" ? "✗" : "•";
  const iconColor =
    stage.state === "ok"
      ? "text-green-400"
      : stage.state === "failed"
      ? "text-red-400"
      : "text-yellow-400 animate-pulse";

  return (
    <div className="mb-1.5">
      <button
        onClick={() => setOverride(!open)}
        className="flex items-center gap-2 w-full text-left hover:bg-brand-900/50 rounded px-1 -mx-1 py-0.5 cursor-pointer"
        aria-expanded={open}
      >
        <span className="text-brand-600 tabular-nums w-[4.5rem] shrink-0">{stage.ts ?? ""}</span>
        <span className="text-brand-500 w-3 shrink-0 select-none">
          {hasBody ? (open ? "▾" : "▸") : " "}
        </span>
        <span className={`${iconColor} w-3 shrink-0`}>{icon}</span>
        <span className="text-brand-100 font-medium">{stage.name}</span>
        {stage.state === "running" && <span className="text-yellow-400/70">running…</span>}
        {stage.duration && (
          <span className="ml-auto text-brand-500 tabular-nums">{stage.duration}</span>
        )}
      </button>

      {open && visibleBody.length > 0 && (
        <div className="ml-[5.75rem] mt-0.5 border-l border-brand-800 pl-3">
          {visibleBody.map((b, i) => (
            <div
              key={i}
              className={[
                "flex gap-2 whitespace-pre-wrap break-all",
                b.debug ? "text-brand-500" : "text-green-300/90",
              ].join(" ")}
            >
              <span className="text-brand-600 tabular-nums shrink-0">{b.ts ?? ""}</span>
              <span className="min-w-0">{b.text}</span>
            </div>
          ))}
        </div>
      )}

      {open && stage.state === "failed" && stage.failReason && (
        <div className="ml-[5.75rem] mt-0.5 border-l border-red-800 pl-3 text-red-400 whitespace-pre-wrap break-all">
          {stage.failReason}
        </div>
      )}
    </div>
  );
}

/**
 * Static rendering of a parsed deploy log (no streaming). Used on the
 * error-analysis pages where the log is fetched once. Dark terminal styling
 * matches the live LogViewer.
 *
 * `fill`: stretch to fill the parent (parent must be a height-bounded flex
 * column) and scroll internally, instead of capping at a fixed max-height.
 */
export function DeployLogView({
  lines,
  showDebug,
  fill = false,
}: {
  lines: string[];
  showDebug: boolean;
  fill?: boolean;
}) {
  const { preamble, stages } = parseLog(lines);
  const visiblePreamble = preamble.filter((b) => showDebug || !b.debug);

  if (lines.length === 0) {
    return (
      <div className="rounded-lg bg-brand-950 border border-brand-800 p-4 font-mono text-xs text-brand-500">
        No log output was captured (logs are kept for a limited time after a
        deploy finishes).
      </div>
    );
  }

  return (
    <div
      className={`rounded-lg bg-brand-950 border border-brand-800 overflow-hidden ${
        fill ? "h-full flex flex-col" : ""
      }`}
    >
      <div
        className={`overflow-y-auto hide-scrollbar p-4 font-mono text-xs leading-relaxed ${
          fill ? "flex-1 min-h-0" : "max-h-[55vh]"
        }`}
      >
        {visiblePreamble.map((b, i) => (
          <div
            key={`p-${i}`}
            className={[
              "flex gap-2 whitespace-pre-wrap break-all",
              b.debug ? "text-brand-500" : "text-brand-300",
            ].join(" ")}
          >
            <span className="text-brand-600 tabular-nums shrink-0 w-[4.5rem]">{b.ts ?? ""}</span>
            <span className="min-w-0">{b.text}</span>
          </div>
        ))}
        {visiblePreamble.length > 0 && stages.length > 0 && <div className="h-2" />}
        {stages.map((s, i) => (
          <StageRow key={`s-${i}-${s.name}`} stage={s} showDebug={showDebug} />
        ))}
      </div>
    </div>
  );
}
