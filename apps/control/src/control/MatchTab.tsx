import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AppState, BasketballExtra, ClientMessage, FootballEvent, FootballExtra, SportPreset, TeamKey } from "@livecg/shared";
import { useAnimationFrame, useClockMs, useServerField } from "../lib/hooks.ts";
import { fmtGameClock, fmtMatchClock, fmtShotClock, parseClockInput } from "../lib/format.ts";
import { useToast } from "../lib/toast.tsx";
import { FOOTBALL_LABEL } from "./describe.ts";

type Send = (m: ClientMessage) => void;
type Sport = "football" | "basketball";

const ADJUST: Record<Sport, Array<[string, number]>> = {
  football: [["−1分", -60_000], ["−1秒", -1_000], ["+1秒", 1_000], ["+1分", 60_000]],
  basketball: [["−1秒", -1_000], ["−0.1", -100], ["+0.1", 100], ["+1秒", 1_000]],
};

const sportOf = (s: AppState): Sport | undefined => (s.match.sport === "football" || s.match.sport === "basketball" ? s.match.sport : undefined);
const external = (s: AppState) => s.config.scoreboard.enabled && s.config.scoreboard.clockSource === "scoreboard";

export function MatchTab({ state, send, hidden }: { state: AppState; send: Send; hidden: boolean }) {
  const sport = sportOf(state);
  return (
    <div className="tabpanel" data-panel="match" hidden={hidden}>
      <SportsSetup state={state} send={send} sport={sport} />
      <ClockPanel state={state} send={send} sport={sport} />
      <FootballPanel state={state} send={send} hidden={sport !== "football"} />
      <BasketballPanel state={state} send={send} hidden={sport !== "basketball"} />
      <ScorePanel state={state} send={send} />
    </div>
  );
}

function SportsSetup({ state, send, sport }: { state: AppState; send: Send; sport?: Sport }) {
  const [presets, setPresets] = useState<SportPreset[]>([]);
  const current = (state.match.extra as { preset?: string }).preset;
  const [sel, setSel] = useState(current ?? "football");
  useEffect(() => {
    fetch("/api/presets").then((r) => r.json()).then(setPresets).catch(() => {});
  }, []);
  useEffect(() => {
    if (current) setSel(current);
  }, [current]);
  return (
    <section>
      <h2>比赛设置</h2>
      <div className="row">
        <select id="presetSel" aria-label="赛制" style={{ flex: 1 }} value={sel} onChange={(e) => setSel(e.target.value)}>
          {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        <button
          id="setupMatch"
          className="primary"
          onClick={() => {
            const label = presets.find((p) => p.id === sel)?.label ?? sel;
            if (confirm(`开始新比赛「${label}」？比分、时钟、犯规/暂停和事件将清零。`)) send({ type: "match.setup", preset: sel as SportPreset["id"] });
          }}
        >开始新比赛</button>
      </div>
      <div className="row period-row">
        <button id="periodPrev" aria-label="上一节" disabled={!sport} onClick={() => send({ type: "period.prev" })}>◀</button>
        <span id="periodLabel" className="period-label">{sport ? state.match.period : "未开始"}</span>
        <button
          id="periodNext"
          aria-label="下一节"
          disabled={!sport}
          onClick={() => {
            if (state.match.clock?.running && !confirm("比赛时钟还在走，确定切到下一节？")) return;
            send({ type: "period.next" });
          }}
        >▶</button>
      </div>
      <p className="hint">「开始新比赛」会清零比分、时钟、犯规/暂停和事件，队名保留。</p>
    </section>
  );
}

/** 时钟读数：只有这个小组件每帧重渲染 */
function ClockReadout({ state, sport }: { state: AppState; sport: Sport }) {
  useAnimationFrame();
  const game = useClockMs(state.match.clock)();
  const shot = useClockMs(state.match.shotClock)();
  const fmt = sport === "basketball" ? fmtGameClock : fmtMatchClock;
  const shotOff = shot === undefined || (game !== undefined && game < shot) || sport !== "basketball";
  return (
    <div className="clock-readout">
      <span id="clockReadout" className={state.match.clock?.running ? "running" : ""}>{game === undefined ? "--:--" : fmt(game)}</span>
      <span id="shotReadout" className={`shot ${!shotOff && shot! < 5_000 ? "low" : ""}`} hidden={shotOff}>{shotOff ? "" : fmtShotClock(shot)}</span>
    </div>
  );
}

function ClockPanel({ state, send, sport }: { state: AppState; send: Send; sport?: Sport }) {
  const toast = useToast();
  const [setText, setSetText] = useState("");
  const added = useServerField((state.match.extra as Partial<FootballExtra>).addedTime || "");
  if (!sport) return <section id="clockPanel" hidden />;
  const ext = external(state);
  const running = !!state.match.clock?.running;
  const doSet = () => {
    const ms = parseClockInput(setText);
    if (ms === undefined) return toast("时间格式应为 mm:ss、mm:ss.t 或 ss.t");
    send({ type: "clock.set", ms });
    setSetText("");
  };
  return (
    <section id="clockPanel">
      <h2>比赛时钟 <span className="grow" /><span className={`tag ${ext ? "pvw" : ""}`} id="clockSourceTag">{ext ? "计分器驱动" : "内部时钟"}</span></h2>
      <ClockReadout state={state} sport={sport} />
      <div className="row">
        <button id="clockToggle" className={`take clock-btn ${running ? "stop" : ""}`} disabled={ext} onClick={() => send({ type: "clock.toggle" })}>{running ? "停止" : "开始"}</button>
        <input
          id="clockSetInput"
          placeholder={sport === "football" ? "例如 45:00" : "例如 2:35.4"}
          aria-label="设置时钟"
          style={{ flex: 1 }}
          disabled={ext}
          value={setText}
          onChange={(e) => setSetText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doSet()}
        />
        <button id="clockSet" disabled={ext} onClick={doSet}>设置</button>
      </div>
      <div className="row" id="clockAdjust">
        {ADJUST[sport].map(([label, d]) => (
          <button key={label} data-adjust={d} disabled={ext} onClick={() => send({ type: "clock.adjust", deltaMs: d })}>{label}</button>
        ))}
      </div>
      <div className="row" id="shotRow" hidden={sport !== "basketball"}>
        <span className="hint" style={{ margin: 0 }}>进攻时钟</span>
        <button data-shot="24000" className="primary" disabled={ext} onClick={() => send({ type: "shotclock.reset", ms: 24_000 })}>24</button>
        <button data-shot="14000" disabled={ext} onClick={() => send({ type: "shotclock.reset", ms: 14_000 })}>14</button>
      </div>
      <div className="row" id="addedRow" hidden={sport !== "football"}>
        <label htmlFor="addedInput">补时（分钟）</label>
        <input id="addedInput" className="num" type="number" min={0} max={30} {...added} />
        <button id="addedSet" onClick={() => send({ type: "football.addedTime", minutes: Number(added.value) || 0 })}>公布</button>
      </div>
      <p className="hint">Shift + 空格 = 开始/停止。时钟由服务端统一计时，所有画面和控制台同步。</p>
    </section>
  );
}

function FootballPanel({ state, send, hidden }: { state: AppState; send: Send; hidden: boolean }) {
  const [type, setType] = useState<FootballEvent["type"]>("goal");
  const [team, setTeam] = useState<TeamKey>("home");
  const [minute, setMinute] = useState("");
  const [player, setPlayer] = useState("");
  const [playerOut, setPlayerOut] = useState("");
  const playerRef = useRef<HTMLInputElement>(null);
  if (hidden) return <section id="footballPanel" hidden />;
  const x = state.match.extra as unknown as FootballExtra;
  const names = { home: state.match.home.shortName || state.match.home.name, away: state.match.away.shortName || state.match.away.name };
  const hint = type === "ownGoal" ? "乌龙球的「球队」选得分方" : type === "sub" ? "球员填换上的，下面填换下的" : "时间留空按比赛时钟自动计算";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    send({
      type: "football.event",
      event: { type, team, player, ...(type === "sub" ? { playerOut } : {}), ...(minute.trim() ? { minute: minute.trim() } : {}) },
    });
    setPlayer("");
    setPlayerOut("");
    setMinute("");
    playerRef.current?.focus();
  };

  return (
    <section id="footballPanel">
      <h2>足球事件</h2>
      <form id="fbForm" autoComplete="off" onSubmit={submit}>
        <div className="row">
          <select name="type" aria-label="事件类型" value={type} onChange={(e) => setType(e.target.value as FootballEvent["type"])}>
            {(["goal", "penaltyGoal", "ownGoal", "yellow", "red", "sub"] as const).map((t) => (
              <option key={t} value={t}>{t === "penaltyGoal" ? "点球" : t === "ownGoal" ? "乌龙球" : FOOTBALL_LABEL[t]}</option>
            ))}
          </select>
          <select name="team" aria-label="球队" value={team} onChange={(e) => setTeam(e.target.value as TeamKey)}>
            <option value="home">{names.home}</option>
            <option value="away">{names.away}</option>
          </select>
          <input name="minute" className="num" placeholder="自动" aria-label="时间（留空按时钟）" value={minute} onChange={(e) => setMinute(e.target.value)} />
        </div>
        <div className="row">
          <input ref={playerRef} name="player" placeholder="球员（换人时为换上球员）" aria-label="球员" required value={player} onChange={(e) => setPlayer(e.target.value)} />
        </div>
        <div className="row" id="fbOutRow" hidden={type !== "sub"}>
          <input name="playerOut" placeholder="换下球员" aria-label="换下球员" value={playerOut} onChange={(e) => setPlayerOut(e.target.value)} />
        </div>
        <div className="row">
          <button type="submit" className="primary">记录事件</button>
          <span className="hint" style={{ margin: 0 }} id="fbHint">{hint}</span>
        </div>
      </form>
      <ul id="fbEvents" className="evlist">
        {x.events?.length ? (
          [...x.events].reverse().map((e) => (
            <li key={e.id}>
              <b>{e.minute}</b>
              <span className={`tag ${e.type === "red" ? "pgm" : ["goal", "penaltyGoal", "ownGoal"].includes(e.type) ? "pvw" : ""}`}>{FOOTBALL_LABEL[e.type] ?? e.type}</span>
              <span className="who">{names[e.team]} · {e.player}{e.playerOut ? ` ↔ ${e.playerOut}` : ""}</span>
              <button
                className="sm danger"
                data-undo={e.id}
                onClick={() => confirm(`撤销 ${e.minute} ${FOOTBALL_LABEL[e.type]} · ${e.player}？`) && send({ type: "football.undo", id: e.id })}
              >撤销</button>
            </li>
          ))
        ) : (
          <li style={{ gridTemplateColumns: "1fr" }}><span className="hint" style={{ margin: 0 }}>还没有事件</span></li>
        )}
      </ul>
    </section>
  );
}

function BasketballPanel({ state, send, hidden }: { state: AppState; send: Send; hidden: boolean }) {
  if (hidden) return <section id="basketballPanel" hidden />;
  const x = state.match.extra as unknown as BasketballExtra;
  const names = { home: state.match.home.shortName || state.match.home.name, away: state.match.away.shortName || state.match.away.name };
  const pts = (team: TeamKey, d: number) => send({ type: "match.patch", patch: { [team]: { score: Math.max(0, state.match[team].score + d) } } });
  return (
    <section id="basketballPanel">
      <h2>篮球</h2>
      <table className="bb">
        <thead><tr><th /><th>全队犯规</th><th>剩余暂停</th><th>球权</th></tr></thead>
        <tbody>
          {(["home", "away"] as const).map((team) => (
            <tr data-team={team} key={team}>
              <th className="tn">{names[team]}</th>
              <td>
                <button data-bb="foul:-1" onClick={() => send({ type: "basketball.foul", team, delta: -1 })}>−</button>
                <b className="fouls" style={{ color: (x.fouls?.[team] ?? 0) >= (x.penaltyFouls ?? 4) ? "var(--live)" : undefined }}>{x.fouls?.[team] ?? 0}</b>
                <button data-bb="foul:1" onClick={() => send({ type: "basketball.foul", team, delta: 1 })}>+</button>
              </td>
              <td>
                <button data-bb="timeout:-1" onClick={() => send({ type: "basketball.timeout", team, delta: -1 })}>−</button>
                <b className="tos">{x.timeouts?.[team] ?? 0}</b>
                <button data-bb="timeout:1" onClick={() => send({ type: "basketball.timeout", team, delta: 1 })}>+</button>
              </td>
              <td>
                <button data-poss={team} className={`poss ${x.possession === team ? "on" : ""}`} onClick={() => send({ type: "basketball.possession", team })}>
                  {team === "home" ? "◀" : "▶"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">犯规达到罚球线时比分条显示红色。比分用下方「比分 / 队伍」或下面的快捷加分。</p>
      {(["home", "away"] as const).map((team) => (
        <div className="row" key={team}>
          <span className="hint" style={{ margin: 0, minWidth: "3em" }} id={team === "home" ? "bbHomeName" : "bbAwayName"}>{names[team]}</span>
          {[1, 2, 3, -1].map((d) => (
            <button key={d} data-pts={`${team}:${d}`} onClick={() => pts(team, d)}>{d > 0 ? `+${d}` : "−1"}</button>
          ))}
        </div>
      ))}
    </section>
  );
}

function ScorePanel({ state, send }: { state: AppState; send: Send }) {
  const m = state.match;
  const homeName = useServerField(m.home.shortName);
  const awayName = useServerField(m.away.shortName);
  const homeColor = useServerField(m.home.color ?? "#2f6bff");
  const awayColor = useServerField(m.away.color ?? "#ff5a36");
  const homeScore = useServerField(m.home.score);
  const awayScore = useServerField(m.away.score);
  const period = useServerField(m.period);
  const bump = (team: TeamKey, d: number) => send({ type: "match.patch", patch: { [team]: { score: Math.max(0, m[team].score + d) } } });
  return (
    <section>
      <h2>比分 / 队伍</h2>
      {([["home", homeName, homeColor, homeScore, "主队"], ["away", awayName, awayColor, awayScore, "客队"]] as const).map(([team, name, color, score, label]) => (
        <div className="row" key={team}>
          <input id={`${team}Name`} placeholder={`${label}简称`} aria-label={`${label}简称`} {...name} />
          <input type="color" id={`${team}Color`} aria-label={`${label}颜色`} {...color} />
          <input className="num" id={`${team}Score`} type="number" aria-label={`${label}比分`} {...score} />
          <button data-score={`${team}:1`} onClick={() => bump(team, 1)}>+1</button>
          <button data-score={`${team}:-1`} onClick={() => bump(team, -1)}>−1</button>
        </div>
      ))}
      <div className="row">
        <input id="period" placeholder="局/节/半场（手动），例如 R12 / Q3" aria-label="局/节" {...period} />
        <button
          className="primary"
          id="applyMatch"
          onClick={() => send({ type: "match.patch", patch: {
            period: period.value,
            home: { shortName: homeName.value, name: homeName.value, color: homeColor.value, score: Number(homeScore.value) },
            away: { shortName: awayName.value, name: awayName.value, color: awayColor.value, score: Number(awayScore.value) },
          } })}
        >应用</button>
      </div>
      <p className="hint">接入 CS2 或计分器后，比分由数据自动驱动。CS2 用队名识别阵营时需与服务器 mp_teamname 一致。</p>
    </section>
  );
}
