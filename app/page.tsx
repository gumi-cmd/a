"use client";

import { useEffect, useMemo, useState } from "react";

type LineKey = "12" | "34";
type Step = "home" | "water" | "fees" | "result";
type UnitEntry = { previous: string; current: string; parking: string };
type Settlement = {
  year: number;
  month: number;
  line: LineKey;
  units: Record<string, UnitEntry>;
  totalWaterBill: string;
  managementFee: string;
  completed: boolean;
  updatedAt: string;
};

const LINES: Record<LineKey, string[]> = {
  "12": ["101", "102", "201", "202", "301", "302", "401", "402", "501", "502"],
  "34": ["103", "104", "203", "204", "303", "304", "403", "404", "503", "504"],
};
const STORAGE_KEY = "building-fee-settlements-v1";

const money = (value: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value));
const numberValue = (value: string) => {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const settlementKey = (year: number, month: number, line: LineKey) =>
  `${year}-${String(month).padStart(2, "0")}-${line}`;

function readAll(): Record<string, Settlement> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function previousPeriod(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function blankSettlement(year: number, month: number, line: LineKey): Settlement {
  const prev = previousPeriod(year, month);
  const previous = readAll()[settlementKey(prev.year, prev.month, line)];
  const units = Object.fromEntries(
    LINES[line].map((unit) => [
      unit,
      {
        previous: previous?.units[unit]?.current || "",
        current: "",
        parking: previous?.units[unit]?.parking || "",
      },
    ]),
  );
  return {
    year,
    month,
    line,
    units,
    totalWaterBill: "",
    managementFee: previous?.managementFee || "20000",
    completed: false,
    updatedAt: new Date().toISOString(),
  };
}

export default function Home() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [line, setLine] = useState<LineKey | null>(null);
  const [step, setStep] = useState<Step>("home");
  const [data, setData] = useState<Settlement | null>(null);
  const [existingChoice, setExistingChoice] = useState<LineKey | null>(null);
  const [saved, setSaved] = useState(true);

  useEffect(() => {
    if (!data || step === "home") return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      const all = readAll();
      all[settlementKey(data.year, data.month, data.line)] = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      setSaved(true);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, step]);

  const calculations = useMemo(() => {
    if (!data) return { rows: [], totalUsage: 0, allocatedWater: 0, grandTotal: 0 };
    const totalUsage = LINES[data.line].reduce((sum, unit) => {
      const entry = data.units[unit];
      return sum + Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
    }, 0);
    const totalBill = numberValue(data.totalWaterBill);
    const management = numberValue(data.managementFee);
    const raw = LINES[data.line].map((unit) => {
      const entry = data.units[unit];
      const usage = Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
      return { unit, entry, usage };
    });
    let assigned = 0;
    const positive = raw.filter((row) => row.usage > 0);
    const rows = raw.map((row) => {
      let water = 0;
      if (totalUsage > 0) {
        const isLast = positive.at(-1)?.unit === row.unit;
        water = row.usage > 0 ? (isLast ? totalBill - assigned : Math.round((totalBill * row.usage) / totalUsage)) : 0;
        assigned += water;
      }
      const parking = numberValue(row.entry.parking);
      return { ...row, water, parking, management, total: water + parking + management };
    });
    return {
      rows,
      totalUsage,
      allocatedWater: rows.reduce((sum, row) => sum + row.water, 0),
      grandTotal: rows.reduce((sum, row) => sum + row.total, 0),
    };
  }, [data]);

  const chooseLine = (selected: LineKey) => {
    const existing = readAll()[settlementKey(year, month, selected)];
    setLine(selected);
    if (existing) setExistingChoice(selected);
    else {
      setData(blankSettlement(year, month, selected));
      setStep("water");
    }
  };

  const begin = (mode: "continue" | "reset") => {
    if (!existingChoice) return;
    const key = settlementKey(year, month, existingChoice);
    setData(mode === "continue" ? readAll()[key] : blankSettlement(year, month, existingChoice));
    setExistingChoice(null);
    setStep("water");
  };

  const updateUnit = (unit: string, field: keyof UnitEntry, value: string) => {
    setData((current) =>
      current
        ? { ...current, units: { ...current.units, [unit]: { ...current.units[unit], [field]: value } } }
        : current,
    );
  };

  const goHome = () => {
    setStep("home");
    setLine(null);
    setData(null);
    setExistingChoice(null);
  };

  const finish = () => {
    setData((current) => (current ? { ...current, completed: true } : current));
    setStep("result");
  };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={goHome} aria-label="처음 화면으로">
          <span>우리집 관리비</span>
        </button>
        {step !== "home" && (
          <div className="headerActions">
            <span className={`saveState ${saved ? "saved" : ""}`}>
              <i /> {saved ? "자동 저장됨" : "저장 중"}
            </span>
            <button className="ghost compact" onClick={goHome}>메인</button>
          </div>
        )}
      </header>

      {step === "home" && (
        <section className="home">
          <div className="eyebrow">월별 관리비 정산 도우미</div>
          <h1>관리비 정산을<br />간단하고 정확하게</h1>
          <p className="lead">수도 사용량부터 주차비, 관리비까지 입력하면 호수별 정산표를 자동으로 만들어 드려요.</p>

          <div className="datePanel">
            <label>
              <span>정산 연도</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {Array.from({ length: 7 }, (_, i) => today.getFullYear() - 3 + i).map((value) => (
                  <option key={value} value={value}>{value}년</option>
                ))}
              </select>
            </label>
            <label>
              <span>정산 월</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => (
                  <option key={value} value={value}>{value}월</option>
                ))}
              </select>
            </label>
          </div>

          <h2>정산할 라인을 선택하세요</h2>
          <div className="lineCards">
            {(["12", "34"] as LineKey[]).map((key) => (
              <button className="lineCard" key={key} onClick={() => chooseLine(key)}>
                <span className="lineNumber">{key === "12" ? "1·2" : "3·4"}</span>
                <span>
                  <b>{key === "12" ? "1·2호 라인" : "3·4호 라인"}</b>
                  <small>{LINES[key][0]}호 — {LINES[key].at(-1)}호 · 10세대</small>
                </span>
                <span className="arrow">→</span>
              </button>
            ))}
          </div>
          <div className="privacy">입력한 내용은 이 기기의 브라우저에만 저장됩니다.</div>
        </section>
      )}

      {step !== "home" && data && (
        <section className="workspace">
          <div className="context">
            <div>
              <span className="eyebrow">{data.line === "12" ? "1·2호 라인" : "3·4호 라인"}</span>
              <h1>{data.year}년 {data.month}월 관리비 정산</h1>
            </div>
            <div className="steps" aria-label="진행 단계">
              {["수도 입력", "비용 입력", "정산 결과"].map((label, index) => {
                const active = ["water", "fees", "result"].indexOf(step);
                return <span key={label} className={index <= active ? "active" : ""}><i>{index + 1}</i>{label}</span>;
              })}
            </div>
          </div>

          {step === "water" && (
            <>
              <div className="sectionIntro">
                <div><span className="sectionNo">01</span><h2>수도 계량값 입력</h2></div>
                <p>이번 달 계량값만 입력하면 사용량이 자동 계산됩니다.</p>
              </div>
              <div className="tableCard">
                <table>
                  <thead><tr><th>호수</th><th>이전 달 계량</th><th>이번 달 계량</th><th>사용량</th></tr></thead>
                  <tbody>
                    {LINES[data.line].map((unit) => {
                      const entry = data.units[unit];
                      const usage = Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
                      const invalid = entry.current !== "" && numberValue(entry.current) < numberValue(entry.previous);
                      return (
                        <tr key={unit}>
                          <th>{unit}호</th>
                          <td><input inputMode="decimal" value={entry.previous} onChange={(e) => updateUnit(unit, "previous", e.target.value)} placeholder="0" /></td>
                          <td><input className={invalid ? "invalid" : ""} inputMode="decimal" value={entry.current} onChange={(e) => updateUnit(unit, "current", e.target.value)} placeholder="입력" /></td>
                          <td><b>{entry.current ? money(usage) : "—"}</b> {entry.current && "톤"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="totalInput">
                <div><span>이번 달 전체 사용량</span><strong>{money(calculations.totalUsage)} <small>톤</small></strong></div>
                <label><span>라인 총 수도요금</span><span className="moneyInput"><input inputMode="numeric" value={data.totalWaterBill} onChange={(e) => setData({ ...data, totalWaterBill: e.target.value })} placeholder="0" /><i>원</i></span></label>
              </div>
              <div className="nav"><button className="ghost" onClick={goHome}>이전</button><button className="primary" onClick={() => setStep("fees")}>비용 입력으로 <span>→</span></button></div>
            </>
          )}

          {step === "fees" && (
            <>
              <div className="sectionIntro">
                <div><span className="sectionNo">02</span><h2>주차비 및 관리비 입력</h2></div>
                <p>주차비는 호수별로, 관리비는 모든 세대에 동일하게 적용됩니다.</p>
              </div>
              <div className="feeLayout">
                <div className="tableCard">
                  <table>
                    <thead><tr><th>호수</th><th>주차비</th></tr></thead>
                    <tbody>
                      {LINES[data.line].map((unit) => (
                        <tr key={unit}><th>{unit}호</th><td><span className="inlineMoney"><input inputMode="numeric" value={data.units[unit].parking} onChange={(e) => updateUnit(unit, "parking", e.target.value)} placeholder="0" /><i>원</i></span></td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <aside className="managementCard">
                  <span className="iconCircle">₩</span>
                  <h3>공통 관리비</h3>
                  <p>입력한 금액이 10세대 모두에게 동일하게 적용됩니다.</p>
                  <span className="moneyInput large"><input inputMode="numeric" value={data.managementFee} onChange={(e) => setData({ ...data, managementFee: e.target.value })} /><i>원</i></span>
                  <small>전체 관리비 합계</small>
                  <strong>{money(numberValue(data.managementFee) * 10)}원</strong>
                </aside>
              </div>
              <div className="nav"><button className="ghost" onClick={() => setStep("water")}>← 수도 입력</button><button className="primary" onClick={finish}>정산 결과 보기 <span>→</span></button></div>
            </>
          )}

          {step === "result" && (
            <>
              <div className="resultTitle"><span>정산 완료</span><h2>{data.year}년 {data.month}월 관리비 정산</h2><p>{data.line === "12" ? "1·2호 라인" : "3·4호 라인"} · 총 10세대</p></div>
              <div className="tableCard resultTable">
                <table>
                  <thead><tr><th>호수</th><th>수도계량</th><th>사용량</th><th>수도요금</th><th>주차비</th><th>관리비</th><th>합계</th></tr></thead>
                  <tbody>
                    {calculations.rows.map((row) => (
                      <tr key={row.unit}><th>{row.unit}호</th><td>{money(numberValue(row.entry.current))}</td><td>{money(row.usage)}톤</td><td>{money(row.water)}원</td><td>{money(row.parking)}원</td><td>{money(row.management)}원</td><td><b>{money(row.total)}원</b></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="summary">
                <div><span>총 수도 사용량</span><strong>{money(calculations.totalUsage)}톤</strong></div>
                <div><span>총 수도요금</span><strong>{money(calculations.allocatedWater)}원</strong></div>
                <div><span>전체 관리비</span><strong>{money(numberValue(data.managementFee) * 10)}원</strong></div>
                <div className="grand"><span>전체 정산 합계</span><strong>{money(calculations.grandTotal)}원</strong></div>
              </div>
              <div className="notice">✓ 정산 결과가 이 브라우저에 자동 저장되었습니다.</div>
              <div className="nav"><button className="ghost" onClick={() => setStep("fees")}>← 수정하기</button><button className="primary" onClick={goHome}>새 정산 시작</button></div>
            </>
          )}
        </section>
      )}

      {existingChoice && (
        <div className="modalBackdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="existing-title">
            <span className="iconCircle">↻</span>
            <h2 id="existing-title">작성 중인 정산이 있어요</h2>
            <p>{year}년 {month}월 · {existingChoice === "12" ? "1·2호 라인" : "3·4호 라인"}에 저장된 내용을 찾았습니다.</p>
            <button className="primary full" onClick={() => begin("continue")}>이어서 작성하기</button>
            <button className="dangerText" onClick={() => begin("reset")}>새로 작성하고 덮어쓰기</button>
            <button className="close" onClick={() => setExistingChoice(null)} aria-label="닫기">×</button>
          </div>
        </div>
      )}
    </main>
  );
}
