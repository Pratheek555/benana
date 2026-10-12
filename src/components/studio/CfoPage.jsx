import React from "react";
import { call, on, isDemo } from "../../api.js";
import { Markdown } from "./BuildPage.jsx";
import { Empty, Icon, ROLE, Status, TraceButton, fmtMoney } from "./shared.jsx";
import "./cfo.css";

const pct = (n) => (n == null ? "Unknown" : `${Math.round(n * 100)}%`);
const money = (n) =>
  n == null ? "Unknown" : n > 0 && n < 0.01 ? "<$0.01" : fmtMoney(n);

function suggestions(books) {
  const t = books?.totals;
  const mod = books?.mods.find(
    (m) => m.status === "passed" && m.costComplete && m.cost > 0 && !m.remix,
  );
  return [
    {
      label: "Sync build costs",
      question:
        "Record my Benana build costs in cfo.ai as a table with one row per mod, including build cost, rework, attempts, and status.",
    },
    mod && {
      label: `Price ${mod.name}`,
      question: `What should I charge for ${mod.name}? It cost ${money(mod.cost)} to build in ${mod.attempts} attempt${mod.attempts === 1 ? "" : "s"}. Use my cfo.ai plan's margins and tell me the break-even.`,
    },
    t?.costPerVerifiedMod != null && {
      label: "Plan 10 mods",
      question: `Build a cfo.ai scenario for shipping 10 mods at my current ${money(t.costPerVerifiedMod)} per verified mod. What is the build spend and how many $1.99 sales cover it?`,
    },
    t?.reworkShare > 0.05 && {
      label: "Review rework",
      question: `${pct(t.reworkShare)} of my recorded spend, ${money(t.rework)}, went to fixes. Show the cost at my current pace and whether I should reduce it.`,
    },
    {
      label: "Set a spend alert",
      question:
        "Set a weekly Benana alert in cfo.ai if my cost per verified mod goes above $1.00.",
    },
  ].filter(Boolean);
}

export default function CfoPage({ mods }) {
  const [books, setBooks] = React.useState();
  const [cfo, setCfo] = React.useState(null);
  const [error, setError] = React.useState("");
  const [question, setQuestion] = React.useState("");
  const [live, setLive] = React.useState(null);
  const [history, setHistory] = React.useState([]);
  const [exported, setExported] = React.useState(null);
  const composerRef = React.useRef(null);
  const version = mods.map((m) => `${m.id}:${m.updatedAt || 0}`).join(",");

  React.useEffect(() => {
    setBooks(undefined);
    call("cfo:books")
      .then(setBooks)
      .catch((e) => {
        setBooks(null);
        setError(e.message);
      });
  }, [version]);
  const check = React.useCallback(() => {
    setCfo((c) => ({ ...(c || {}), checking: true }));
    call("cfo:status")
      .then(setCfo)
      .catch((e) => setCfo({ state: "failed", detail: e.message }));
  }, []);
  React.useEffect(() => {
    const off = on("cfo:event", (ev) => {
      if (ev.kind === "start")
        setLive({ id: ev.askId, question: ev.question, events: [] });
      else if (ev.kind === "done") {
        setLive((l) => (l?.id === ev.askId ? { ...l, entry: ev.entry } : l));
        setHistory((h) => [ev.entry, ...h.filter((x) => x.id !== ev.entry.id)]);
      } else
        setLive((l) =>
          l?.id === ev.askId
            ? { ...l, events: [...l.events, ev].slice(-40) }
            : l,
        );
    });
    check();
    call("cfo:history")
      .then(setHistory)
      .catch(() => {});
    call("cfo:active")
      .then((active) => {
        if (active) setLive((l) => l || active);
      })
      .catch(() => {});
    return off;
  }, [check]);

  const asking = Boolean(live && !live.entry);
  const ask = (value = question) => {
    const text = value.trim();
    if (!text || asking) return;
    setError("");
    setQuestion("");
    setLive({ id: null, question: text, events: [] });
    call("cfo:ask", { question: text })
      .then((entry) => {
        setLive((l) =>
          l?.entry
            ? l
            : { ...(l || { question: text, events: [] }), id: entry.id, entry },
        );
        setHistory((h) => [entry, ...h.filter((x) => x.id !== entry.id)]);
      })
      .catch((e) => {
        setError(e.message);
        setQuestion(text);
        setLive(null);
      });
  };
  const prefill = (value) => {
    setQuestion(value);
    requestAnimationFrame(() => composerRef.current?.focus());
  };
  const totals = books?.totals;
  return (
    <div className="view cfo-page">
      <header className="cfo-page-head">
        <div>
          <div className="cfo-brand">
            <span>C</span>cfo.ai
          </div>
          <h1>Creator finances</h1>
          <p>
            Recorded build costs, pricing context, and a finance copilot
            grounded in your work.
          </p>
        </div>
        <CfoBadge cfo={cfo} />
      </header>
      {error && (
        <div className="cfo-alert" role="alert">
          {error}
        </div>
      )}
      {isDemo && (
        <div className="cfo-sample">
          <strong>Sample data</strong>
          <span>
            This preview uses local demo costs. Connect the desktop app for your
            books and cfo.ai model.
          </span>
        </div>
      )}
      <section className="cfo-kpis" aria-label="Finance summary">
        <Kpi
          label="Recorded spend"
          value={money(totals?.spend)}
          detail={
            totals ? `${totals.mods} mods recorded` : "Waiting for records"
          }
        />
        <Kpi
          label="Verified cost"
          value={money(totals?.costPerVerifiedMod)}
          detail={
            totals
              ? `Per passed mod · ${totals.passed} verified`
              : "Per passed mod"
          }
        />
        <Kpi
          label="Rework share"
          value={pct(totals?.reworkShare)}
          detail={
            totals
              ? `${money(totals.rework)} in fix attempts`
              : "No rework total yet"
          }
          tone={totals?.reworkShare > 0.2 ? "warn" : ""}
        />
        <Kpi
          label="First-try pass rate"
          value={pct(totals?.firstTryRate)}
          detail={totals ? "Of finished mods" : "No finished mods yet"}
        />
      </section>
      <div className="cfo-workspace">
        <div className="cfo-overview">
          <SpendOverview totals={totals} loading={books === undefined} />
          <Quote onAsk={prefill} />
          <Books
            books={books}
            asking={asking}
            exported={exported}
            onExport={() =>
              call("cfo:export")
                .then(setExported)
                .catch((e) => setError(e.message))
            }
            onShow={(dir) =>
              call("open-path", dir).catch((e) => setError(e.message))
            }
            onAsk={prefill}
          />
          <Methodology totals={totals} />
        </div>
        <ChatRail
          cfo={cfo}
          onCheck={check}
          onChange={setCfo}
          live={live}
          history={history}
          asking={asking}
          question={question}
          setQuestion={setQuestion}
          ask={ask}
          prefill={prefill}
          composerRef={composerRef}
          prompts={suggestions(books)}
          onError={setError}
        />
      </div>
    </div>
  );
}

function Kpi({ label, value, detail, tone }) {
  return (
    <article className={`cfo-kpi ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}
function CfoBadge({ cfo }) {
  const state = cfo?.checking ? "checking" : cfo?.state;
  const label =
    {
      connected: "Connected",
      sample: "Sample mode",
      "needs-auth": "Sign in needed",
      "not-added": "Not connected",
      failed: "Unavailable",
      checking: "Checking…",
      "no-claude": "Claude Code missing",
    }[state] || "Checking…";
  return (
    <span
      className={`cfo-badge ${state === "connected" ? "ok" : ""}`}
      title={cfo?.detail || "cfo.ai connection status"}
    >
      <i />
      {label}
    </span>
  );
}
function CardHead({ eyebrow, title, children }) {
  return (
    <header className="cfo-card-head">
      <div>
        {eyebrow && <span>{eyebrow}</span>}
        <h2>{title}</h2>
      </div>
      {children}
    </header>
  );
}
function SpendOverview({ totals, loading }) {
  const roles = Object.entries(totals?.byRole || {})
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = roles.reduce((sum, [, v]) => sum + v, 0);
  const models = Object.entries(totals?.byModel || {}).filter(([, v]) => v > 0);
  return (
    <section className="cfo-card cfo-spend-card">
      <CardHead eyebrow="Recorded usage" title="Where build spend goes">
        <span className="cfo-card-total">{money(totals?.spend)}</span>
      </CardHead>
      {loading ? (
        <Empty>Loading recorded spend…</Empty>
      ) : !totals || !roles.length ? (
        <Empty>Agent costs will appear here after a recorded build.</Empty>
      ) : (
        <>
          <div
            className="cfo-spend-bar"
            aria-label="Recorded spend split by agent role"
          >
            {roles.map(([role, v]) => (
              <i
                key={role}
                className={`r-${role}`}
                style={{ width: `${(v / total) * 100}%` }}
                title={`${ROLE[role] || role}: ${money(v)}`}
              />
            ))}
          </div>
          <ul className="cfo-spend-list">
            {roles.map(([role, v]) => (
              <li key={role}>
                <i className={`r-${role}`} />
                <span>{ROLE[role] || role}</span>
                <strong>{money(v)}</strong>
                <small>{pct(v / total)}</small>
              </li>
            ))}
          </ul>
          {models.length > 0 && (
            <p className="cfo-models">
              Model usage{" "}
              {models.map(([model, v]) => `${model} ${money(v)}`).join(" · ")}
            </p>
          )}
        </>
      )}
    </section>
  );
}

function ChatRail({
  cfo,
  onCheck,
  onChange,
  live,
  history,
  asking,
  question,
  setQuestion,
  ask,
  prefill,
  composerRef,
  prompts,
  onError,
}) {
  const threadRef = React.useRef(null);
  const followingRef = React.useRef(true);
  React.useLayoutEffect(() => {
    followingRef.current = true;
  }, [live?.question]);
  React.useLayoutEffect(() => {
    const thread = threadRef.current;
    if (thread && (live || history.length) && followingRef.current)
      thread.scrollTop = thread.scrollHeight;
  }, [
    live?.id,
    live?.question,
    live?.events?.length,
    live?.entry,
    history.length,
  ]);
  const messages = history.filter((entry) => entry.id !== live?.id);
  return (
    <aside className="cfo-chat" aria-label="CFO conversation">
      <div className="cfo-chat-top">
        <header className="cfo-chat-head">
          <div className="cfo-avatar">
            <Icon name="spark" size={17} />
          </div>
          <div>
            <strong>Your CFO</strong>
            <span>Finance copilot · cfo.ai</span>
          </div>
          <CfoBadge cfo={cfo} />
        </header>
        {!isDemo && cfo && cfo.state !== "connected" && !cfo.checking && (
          <ConnectSteps cfo={cfo} onChange={onChange} onCheck={onCheck} />
        )}
      </div>
      <div
        className="cfo-thread"
        ref={threadRef}
        onScroll={() => {
          const el = threadRef.current;
          followingRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
        }}
      >
        {!live && !messages.length && (
          <Welcome prompts={prompts} onSelect={prefill} />
        )}
        {[...messages].reverse().map((entry) => (
          <Conversation
            key={entry.id}
            item={{ question: entry.question, events: [], entry }}
          />
        ))}
        {live && <Conversation item={live} />}
      </div>
      <form
        className="cfo-composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        {(live || messages.length > 0) && (
          <details className="cfo-starters">
            <summary>Suggested questions</summary>
            <div className="cfo-prompts">
              {prompts.map((prompt) => (
                <button key={prompt.label} type="button" disabled={asking} onClick={() => prefill(prompt.question)}>
                  {prompt.label}
                </button>
              ))}
            </div>
          </details>
        )}
        <label htmlFor="cfo-question">Ask about your creator finances</label>
        <div>
          <textarea
            id="cfo-question"
            ref={composerRef}
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              ) {
                e.preventDefault();
                ask();
              }
            }}
            placeholder="Ask about pricing, costs, or a plan…"
            disabled={asking}
          />
          {asking ? (
            <button
              type="button"
              className="cfo-send stop"
              onClick={() => call("cfo:stop").catch((e) => onError(e.message))}
              aria-label="Stop CFO response"
            >
              <Icon name="stop" />
            </button>
          ) : (
            <button
              className="cfo-send"
              disabled={!question.trim()}
              aria-label="Send question"
            >
              <Icon name="send" />
            </button>
          )}
        </div>
        <small>Enter to send · Shift+Enter for a new line</small>
      </form>
    </aside>
  );
}
function Welcome({ prompts, onSelect }) {
  return (
    <div className="cfo-welcome">
      <div className="cfo-welcome-mark">
        <Icon name="spark" size={22} />
      </div>
      <h2>What should we work through?</h2>
      <p>
        I can combine your recorded build costs with your cfo.ai plan for
        pricing and budget questions.
      </p>
      <div className="cfo-prompts">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onSelect(prompt.question)}
          >
            <span>{prompt.label}</span>
            <Icon name="arrow" size={14} />
          </button>
        ))}
      </div>
    </div>
  );
}
function Conversation({ item }) {
  return (
    <div className="cfo-exchange">
      <div className="cfo-user-message">{item.question}</div>
      <Answer live={item} />
    </div>
  );
}
function ConnectSteps({ cfo, onChange, onCheck }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const run = (channel) => {
    setBusy(true);
    setError("");
    call(channel)
      .then((r) => {
        if (r?.state) onChange(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <details className="cfo-connect">
      <summary>Connect cfo.ai</summary>
      <div>
        <p>Connect your plan for saved scenarios, alerts, and model context.</p>
        {!cfo.added && (
          <button
            className="btn sm"
            disabled={busy}
            onClick={() => run("cfo:connect")}
          >
            Add cfo.ai
          </button>
        )}
        <button
          className="btn sm"
          disabled={busy || !cfo.added}
          onClick={() => run("cfo:signin")}
        >
          Open sign-in
        </button>
        <button className="btn sm" disabled={busy} onClick={onCheck}>
          Check
        </button>
        <small>
          New to cfo.ai?{" "}
          <button
            className="cfo-link"
            onClick={() =>
              window.benana?.openExternal("https://cfo.ai/neathacks")
            }
          >
            Create an account
          </button>
          .
        </small>
        {error && <small className="bad">{error}</small>}
      </div>
    </details>
  );
}
function Answer({ live }) {
  const entry = live.entry;
  const events = live.events || [];
  const calls = entry?.tools?.length
    ? entry.tools
    : events
        .filter((e) => e.kind === "tool")
        .map((e) => ({ name: e.name, cfo: e.cfo }));
  const cfoCalls = calls.filter((x) => x.cfo);
  const thinking = events.filter((e) => e.kind === "text").at(-1)?.text;
  return (
    <div className="cfo-assistant-message">
      {calls.length > 0 && (
        <div className="cfo-calls">
          {calls.map((item, i) => (
            <span key={i} className={item.cfo ? "cfo" : ""}>
              {item.cfo ? "cfo.ai" : "Benana"} ·{" "}
              {item.cfo
                ? item.name
                : item.name === "Read"
                  ? "read build costs"
                  : item.name}
            </span>
          ))}
        </div>
      )}
      {!entry && (
        <p className="cfo-working">
          <i />
          {thinking
            ? thinking.slice(0, 220)
            : cfoCalls.length
              ? "Working in cfo.ai…"
              : "Reading your books…"}
        </p>
      )}
      {entry?.answer && <Markdown text={entry.answer} />}
      {entry?.error && !entry.answer && <p className="bad">{entry.error}</p>}
      {entry && (
        <footer>
          <span>
            {cfoCalls.length
              ? `${cfoCalls.length} cfo.ai call${cfoCalls.length === 1 ? "" : "s"}`
              : "Benana books only"}
          </span>
          {entry.usage?.costUsd != null && (
            <span>Answer cost {money(entry.usage.costUsd)}</span>
          )}
          <TraceButton sessionId={entry.sessionId} />
        </footer>
      )}
    </div>
  );
}

function Quote({ onAsk }) {
  const [prompt, setPrompt] = React.useState("");
  const [quote, setQuote] = React.useState(null);
  const [error, setError] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const run = (e) => {
    e?.preventDefault();
    const text = prompt.trim();
    if (!text || pending) return;
    setPending(true);
    setError("");
    setQuote(null);
    call("cfo:quote", { prompt: text })
      .then((r) =>
        r.ok ? setQuote({ ...r, prompt: text }) : setError(r.error),
      )
      .catch((x) => setError(x.message))
      .finally(() => setPending(false));
  };
  return (
    <section className="cfo-card cfo-quote">
      <CardHead eyebrow="Before you build" title="Estimate a mod" />
      <p className="cfo-card-copy">
        Compare an idea with your closest recorded builds and their fix history.
      </p>
      <form onSubmit={run}>
        <label htmlFor="quote-prompt">Mod idea</label>
        <div>
          <textarea
            id="quote-prompt"
            rows={2}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing
              )
                run(e);
            }}
            placeholder="A trident that calls down lightning on hit"
          />
          <button className="btn solid" disabled={!prompt.trim() || pending}>
            {pending ? "Estimating…" : "Estimate"}
          </button>
        </div>
      </form>
      {error && (
        <p className="bad" role="alert">
          {error}
        </p>
      )}
      {quote && (
        <div className="cfo-quote-result">
          <div>
            <span>Expected recorded cost</span>
            <strong>{money(quote.expected)}</strong>
            <small>
              Likely {money(quote.low)} to {money(quote.high)}
            </small>
          </div>
          <div>
            <span>Fix likelihood</span>
            <strong>{pct(quote.fixChance)}</strong>
            <small>
              {quote.costPerFix
                ? `${money(quote.costPerFix)} per fix round`
                : "Based on recorded attempts"}
            </small>
          </div>
          <p>
            {quote.matched ? "Closest records" : "Using all recorded builds"}:{" "}
            {quote.basis.map((b) => `${b.name} ${money(b.cost)}`).join(" · ")}
          </p>
          <button
            className="btn sm"
            onClick={() =>
              onAsk(
                `I'm about to build this mod: "${quote.prompt}". Benana estimates ${money(quote.expected)} to build, with a range of ${money(quote.low)} to ${money(quote.high)} and a ${pct(quote.fixChance)} chance of a fix. Given my cfo.ai plan, is it worth building, what price pays it back, and what budget should I set?`,
              )
            }
          >
            Discuss with my CFO
          </button>
        </div>
      )}
    </section>
  );
}
function Books({ books, asking, exported, onExport, onShow, onAsk }) {
  return (
    <section className="cfo-card cfo-books">
      <CardHead eyebrow="Cost ledger" title="Mod books">
        <div className="cfo-actions">
          <button className="btn sm" onClick={onExport}>
            Export CSV
          </button>
          {exported && (
            <button className="btn sm" onClick={() => onShow(exported.dir)}>
              Show file · {exported.rows}
            </button>
          )}
        </div>
      </CardHead>
      {books === undefined ? (
        <Empty>Loading mod books…</Empty>
      ) : !books ? (
        <Empty>Build costs could not be loaded.</Empty>
      ) : !books.mods.length ? (
        <Empty>Build a mod and its recorded costs will appear here.</Empty>
      ) : (
        <div className="cfo-table-wrap">
          <table className="cfo-table">
            <thead>
              <tr>
                <th>Mod</th>
                <th>Status</th>
                <th className="num">Attempts</th>
                <th className="num">Build cost</th>
                <th className="num">Rework</th>
                <th className="num">$1.99 payback</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {books.mods.map((m) => (
                <tr key={m.id}>
                  <td>
                    <strong>{m.name}</strong>
                    {m.remix && (
                      <small>Remix{m.remixOf ? ` of ${m.remixOf}` : ""}</small>
                    )}
                  </td>
                  <td>
                    <Status status={m.status} />
                  </td>
                  <td className="num">{m.attempts}</td>
                  <td className="num">
                    {money(m.cost)}
                    {m.cost != null && !m.costComplete && (
                      <small>Partial record</small>
                    )}
                  </td>
                  <td className="num">{money(m.rework)}</td>
                  <td className="num">
                    {!m.costComplete
                      ? "Unknown"
                      : `${m.breakEven[1].sales} sale${m.breakEven[1].sales === 1 ? "" : "s"}`}
                  </td>
                  <td className="num">
                    {m.status === "passed" && m.costComplete && (
                      <button
                        className="cfo-row-action"
                        disabled={asking}
                        onClick={() =>
                          onAsk(
                            `What should I charge for ${m.name}? It cost ${money(m.cost)} in ${m.attempts} attempt${m.attempts === 1 ? "" : "s"}${m.rework ? `, with ${money(m.rework)} spent on fixes` : ""}. Use my cfo.ai plan's margins and tell me the break-even.`,
                          )
                        }
                      >
                        Price it
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function Methodology({ totals }) {
  return (
    <details className="cfo-method">
      <summary>How these numbers are calculated</summary>
      <p>
        Build costs use the API cost reported for each agent session in local
        mod records. Verified cost divides total spend, including failed builds,
        by the number of passed mods. It is unknown when any build has incomplete
        cost records. Payback uses the gross $1.99 listed price. It excludes
        marketplace fees, payment fees, tax, refunds, and support time.{" "}
        {totals?.uncostedSessions
          ? `${totals.uncostedSessions} session${totals.uncostedSessions === 1 ? " has" : "s have"} no reported cost and stays outside the totals.`
          : totals
            ? "All recorded sessions include cost data."
            : "Cost coverage is not available yet."}
      </p>
    </details>
  );
}
