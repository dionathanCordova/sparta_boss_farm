"use client";

import { useEffect, useMemo, useState } from "react";
import type { Boss } from "@/lib/bosses";
import {
  fmtClock,
  fmtDateLabel,
  fmtSpawnAt,
  fmtEta,
  statusFor,
  parseDurationToMinutes,
} from "@/lib/format";

type BossesResponse = {
  bosses: Boss[];
  now: string;
  discordConfigured: boolean;
  persistenceDurable: boolean;
  warnMinutes: number;
};

const POLL_MS = 15_000;

export default function Page() {
  const [bosses, setBosses] = useState<Boss[]>([]);
  const [discordConfigured, setDiscordConfigured] = useState(false);
  const [persistenceDurable, setPersistenceDurable] = useState(true);
  const [warnMinutes, setWarnMinutes] = useState(10);
  const [loaded, setLoaded] = useState(false);
  const [nowTick, setNowTick] = useState<Date>(() => new Date());
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errorFlash, setErrorFlash] = useState<Record<string, boolean>>({});

  async function loadBosses() {
    try {
      const res = await fetch("/api/bosses", { cache: "no-store" });
      if (!res.ok) return;
      const data: BossesResponse = await res.json();
      setBosses(data.bosses);
      setDiscordConfigured(data.discordConfigured);
      setPersistenceDurable(data.persistenceDurable);
      setWarnMinutes(data.warnMinutes);
      setLoaded(true);
    } catch {
      // network hiccup — keep showing the last known state, retry on next poll
    }
  }

  useEffect(() => {
    loadBosses();
    const pollId = setInterval(loadBosses, POLL_MS);
    const tickId = setInterval(() => setNowTick(new Date()), 1000);
    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
    };
  }, []);

  const byServer = useMemo(() => {
    const map = new Map<string, Boss[]>();
    for (const b of bosses) {
      if (!map.has(b.server)) map.set(b.server, []);
      map.get(b.server)!.push(b);
    }
    for (const list of map.values()) {
      list.sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime());
    }
    return map;
  }, [bosses]);

  const nextUp = useMemo(() => {
    return bosses
      .filter((b) => new Date(b.spawnAt).getTime() - nowTick.getTime() > 0)
      .sort((a, b) => new Date(a.spawnAt).getTime() - new Date(b.spawnAt).getTime())
      .slice(0, 5);
  }, [bosses, nowTick]);

  async function handleSubmit(boss: Boss) {
    const raw = inputs[boss.id] ?? "";
    const minutes = parseDurationToMinutes(raw);
    if (minutes === null) {
      setErrorFlash((s) => ({ ...s, [boss.id]: true }));
      setTimeout(() => setErrorFlash((s) => ({ ...s, [boss.id]: false })), 900);
      return;
    }
    setPending((s) => ({ ...s, [boss.id]: true }));
    try {
      const res = await fetch(`/api/bosses/${boss.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes }),
      });
      if (res.ok) {
        const data: { boss: Boss } = await res.json();
        setBosses((prev) => prev.map((b) => (b.id === boss.id ? data.boss : b)));
        setInputs((s) => ({ ...s, [boss.id]: "" }));
      } else {
        setErrorFlash((s) => ({ ...s, [boss.id]: true }));
        setTimeout(() => setErrorFlash((s) => ({ ...s, [boss.id]: false })), 900);
      }
    } finally {
      setPending((s) => ({ ...s, [boss.id]: false }));
    }
  }

  return (
    <div className="wrap">
      <header className="top">
        <div className="title-block">
          <h1>Spawn dos Bosses</h1>
          <p>Defina o respawn de cada boss aqui e o alerta sai sozinho no Discord.</p>
          <div className="status-line">
            <span className={`status-dot ${discordConfigured ? "on" : "off"}`} />
            <span>
              {discordConfigured
                ? "Alertas no Discord: configurados"
                : "Alertas no Discord: defina DISCORD_WEBHOOK_URL (veja o README)"}
            </span>
          </div>
          {!persistenceDurable && (
            <div className="status-line">
              <span className="status-dot off" />
              <span>Sem banco configurado (Upstash) — em produção os horários somem a cada redeploy. Veja o README.</span>
            </div>
          )}
        </div>
        <div className="clock">
          <div className="now">{fmtClock(nowTick)}</div>
          <div className="label">{fmtDateLabel(nowTick)}</div>
        </div>
      </header>

      <p className="eyebrow">Próximos a nascer</p>
      <div className="nextup">
        {loaded && nextUp.length === 0 && (
          <p className="nextup-empty">Nenhum boss com horário futuro definido ainda.</p>
        )}
        {nextUp.map((b) => {
          const ms = new Date(b.spawnAt).getTime() - nowTick.getTime();
          return (
            <div className="nextup-card" key={b.id}>
              <div className="srv">{b.server}</div>
              <div className="boss">{b.name}</div>
              <div className="eta">{fmtEta(ms) ?? "00:00:00"}</div>
              <div className="at">{fmtSpawnAt(new Date(b.spawnAt), nowTick)}</div>
            </div>
          );
        })}
      </div>

      <div className="board">
        {Array.from(byServer.entries()).map(([server, list]) => (
          <div className="server" key={server}>
            <div className="server-head">
              <h2>{server}</h2>
              <span className="count">{list.length} bosses</span>
            </div>
            <ul className="bosses">
              {list.map((b) => {
                const ms = new Date(b.spawnAt).getTime() - nowTick.getTime();
                const st = statusFor(ms);
                return (
                  <li className="boss-row" key={b.id}>
                    <div className="name-col">
                      <div className="boss-name">{b.name}</div>
                      <div className="spawn-at">{fmtSpawnAt(new Date(b.spawnAt), nowTick)}</div>
                    </div>
                    <div className="status-col">
                      <div className="eta">{fmtEta(ms) ?? "00:00:00"}</div>
                      <span className={`pill ${st.cls}`}>{st.label}</span>
                    </div>
                    <div className="reset-row">
                      <div className="reset-left">
                        <label htmlFor={`${b.id}-input`}>respawn:</label>
                        <input
                          id={`${b.id}-input`}
                          className="reset-input"
                          type="text"
                          inputMode="text"
                          placeholder="ex. 3:11"
                          aria-label={`Tempo restante até ${b.name} nascer novamente`}
                          value={inputs[b.id] ?? ""}
                          onChange={(e) =>
                            setInputs((s) => ({ ...s, [b.id]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              handleSubmit(b);
                            }
                          }}
                          style={errorFlash[b.id] ? { borderColor: "var(--urgent)" } : undefined}
                        />
                        <button
                          type="button"
                          className="reset-btn"
                          disabled={pending[b.id]}
                          onClick={() => handleSubmit(b)}
                        >
                          definir respawn
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      <footer className="page-footer">
        Boss nasceu de novo (ou o jogo te deu um novo tempo)? Digite o tempo restante até o
        próximo nascimento (ex.: <strong>3:11</strong> para 3h11, ou só <strong>45</strong> para
        45 min) no campo abaixo do boss e clique em <strong>definir respawn</strong>. O aviso no
        Discord sai sozinho {warnMinutes} min antes e de novo na hora exata — não precisa fazer
        mais nada.
      </footer>
    </div>
  );
}
