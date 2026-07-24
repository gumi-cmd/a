"use client";

import { useEffect, useMemo, useState } from "react";

type LineKey = "12" | "34";
type Step = "home" | "water" | "fees" | "result" | "history";
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
type ResultRow = {
  unit: string;
  entry: UnitEntry;
  usage: number;
  water: number;
  parking: number;
  management: number;
  total: number;
};

const LINES: Record<LineKey, string[]> = {
  "12": ["101", "102", "201", "202", "301", "302", "501", "502"],
  "34": ["103", "104", "203", "204", "303", "304", "503", "504"],
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
const lineName = (line: LineKey) => (line === "12" ? "1·2호 라인" : "3·4호 라인");

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

function calculate(settlement: Settlement | null) {
  if (!settlement) return { rows: [] as ResultRow[], totalUsage: 0, allocatedWater: 0, grandTotal: 0 };
  const units = LINES[settlement.line];
  const totalUsage = units.reduce((sum, unit) => {
    const entry = settlement.units[unit] || { previous: "", current: "", parking: "" };
    return sum + Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
  }, 0);
  const totalBill = numberValue(settlement.totalWaterBill);
  const management = numberValue(settlement.managementFee);
  const raw = units.map((unit) => {
    const entry = settlement.units[unit] || { previous: "", current: "", parking: "" };
    return { unit, entry, usage: Math.max(0, numberValue(entry.current) - numberValue(entry.previous)) };
  });
  let assigned = 0;
  const positive = raw.filter((row) => row.usage > 0);
  const rows: ResultRow[] = raw.map((row) => {
    let water = 0;
    if (totalUsage > 0) {
      const isLast = positive.at(-1)?.unit === row.unit;
      water = row.usage > 0
        ? isLast
          ? totalBill - assigned
          : Math.round((totalBill * row.usage) / totalUsage)
        : 0;
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
}

function downloadPng(settlement: Settlement, rows: ResultRow[]) {
  const canvas = document.createElement("canvas");
  // A4 portrait at 300dpi, laid out like a vertically-read paper document.
  const width = 2480;
  const height = 3508;
  const margin = 120;
  const titleHeight = 360;
  const rowHeight = 255;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111111";
  ctx.textAlign = "center";
  ctx.font = "900 84px Arial, sans-serif";
  ctx.fillText(`${settlement.year}년 ${settlement.month}월 관리비 정산`, width / 2, margin + 110);
  ctx.font = "800 46px Arial, sans-serif";
  ctx.fillText(`${lineName(settlement.line)}`, width / 2, margin + 205);

  const headers = ["호수", "수도계량", "사용량", "수도요금", "주차비", "관리비", "합계"];
  const columnWidths = [240, 330, 300, 350, 320, 320, 380];
  const tableX = margin;
  const tableY = margin + titleHeight;

  const drawCell = (x: number, y: number, w: number, h: number, text: string, bold = false) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000000";
    ctx.lineWidth = 8;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#000000";
    let fontSize = bold ? 43 : 40;
    ctx.font = `${bold ? 900 : 750} ${fontSize}px Arial, sans-serif`;
    while (ctx.measureText(text).width > w - 28 && fontSize > 28) {
      fontSize -= 2;
      ctx.font = `${bold ? 900 : 750} ${fontSize}px Arial, sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + w / 2, y + h / 2);
  };

  let x = tableX;
  headers.forEach((header, index) => {
    drawCell(x, tableY, columnWidths[index], rowHeight, header, true);
    x += columnWidths[index];
  });
  rows.forEach((row, rowIndex) => {
    const values = [
      `${row.unit}호`,
      money(numberValue(row.entry.current)),
      `${money(row.usage)}톤`,
      `${money(row.water)}원`,
      `${money(row.parking)}원`,
      `${money(row.management)}원`,
      `${money(row.total)}원`,
    ];
    x = tableX;
    values.forEach((value, columnIndex) => {
      drawCell(x, tableY + rowHeight * (rowIndex + 1), columnWidths[columnIndex], rowHeight, value, columnIndex === 0 || columnIndex === 6);
      x += columnWidths[columnIndex];
    });
  });

  const link = document.createElement("a");
  link.download = `${settlement.year}-${String(settlement.month).padStart(2, "0")}-${settlement.line}-관리비정산.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export default function Home() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [step, setStep] = useState<Step>("home");
  const [data, setData] = useState<Settlement | null>(null);
  const [existingChoice, setExistingChoice] = useState<LineKey | null>(null);
  const [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<Record<string, Settlement>>({});
  const [historyYear, setHistoryYear] = useState<number | null>(null);

  useEffect(() => {
    if (!data || step === "home" || step === "history") return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      const all = readAll();
      all[settlementKey(data.year, data.month, data.line)] = { ...data, updatedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      setSaved(true);
      setHistory(all);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, step]);

  const calculations = useMemo(() => calculate(data), [data]);
  const completedRecords = useMemo(
    () =>
      Object.entries(history)
        .filter(([, record]) => record.completed)
        .sort(([, a], [, b]) => b.year - a.year || b.month - a.month || a.line.localeCompare(b.line)),
    [history],
  );
  const historyYears = useMemo(
    () => Array.from(new Set(completedRecords.map(([, record]) => record.year))).sort((a, b) => b - a),
    [completedRecords],
  );
  const visibleRecords = completedRecords.filter(([, record]) => historyYear === null || record.year === historyYear);

  const chooseLine = (selected: LineKey) => {
    const existing = readAll()[settlementKey(year, month, selected)];
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
        ? { ...current, units: { ...current.units, [unit]: { ...(current.units[unit] || { previous: "", current: "", parking: "" }), [field]: value } } }
        : current,
    );
  };
  const goHome = () => {
    setStep("home");
    setData(null);
    setExistingChoice(null);
  };
  const openHistory = () => {
    const all = readAll();
    setHistory(all);
    const years = Array.from(new Set(Object.values(all).filter((item) => item.completed).map((item) => item.year))).sort((a, b) => b - a);
    setHistoryYear(years[0] || null);
    setStep("history");
  };
  const finish = () => {
    setData((current) => (current ? { ...current, completed: true } : current));
    setStep("result");
  };

  return (
    <main>
      <header className="topbar">
        <button className="brand" onClick={goHome}>관리비 계산기</button>
        {step !== "home" && (
          <div className="headerActions">
            {step !== "history" && <span className={`saveState ${saved ? "saved" : ""}`}><i />{saved ? "자동 저장됨" : "저장 중"}</span>}
            <button className="ghost compact" onClick={goHome}>메인</button>
          </div>
        )}
      </header>

      {step === "home" && (
        <section className="home">
          <h1>관리비 계산기</h1>
          <div className="homeTools">
            <button className="historyButton" onClick={openHistory}>
              <span className="folderIcon">▣</span>
              <span><b>정산 기록 보기</b><small>연도·월별 완료된 정산표</small></span>
              <span>→</span>
            </button>
          </div>
          <div className="datePanel">
            <label><span>정산 연도</span>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
                {Array.from({ length: 9 }, (_, i) => today.getFullYear() - 4 + i).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label><span>정산 월</span>
              <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
          </div>
          <h2>정산할 라인을 선택하세요</h2>
          <div className="lineCards">
            {(["12", "34"] as LineKey[]).map((key) => (
              <button className="lineCard" key={key} onClick={() => chooseLine(key)}>
                <span className="lineNumber">{key === "12" ? "1·2" : "3·4"}</span>
                <span><b>{lineName(key)}</b><small>{LINES[key].join(" · ")}호 · {LINES[key].length}세대</small></span>
                <span className="arrow">→</span>
              </button>
            ))}
          </div>
          <p className="privacy">입력한 내용은 이 브라우저에 자동 저장됩니다.</p>
        </section>
      )}

      {step === "history" && (
        <section className="historyPage">
          <div className="historyHeading">
            <div><h1>정산 기록</h1><p>완료된 정산표를 연도와 월별로 확인할 수 있습니다.</p></div>
            <button className="primary" onClick={goHome}>새 정산 만들기</button>
          </div>
          {completedRecords.length === 0 ? (
            <div className="emptyHistory"><b>저장된 정산 기록이 없습니다.</b><p>정산을 완료하면 이곳에 자동으로 표시됩니다.</p></div>
          ) : (
            <div className="explorer">
              <aside className="yearFolders">
                <h2>연도</h2>
                {historyYears.map((item) => (
                  <button key={item} className={historyYear === item ? "selected" : ""} onClick={() => setHistoryYear(item)}>
                    <span>▰</span>{item}년
                  </button>
                ))}
              </aside>
              <div className="monthFiles">
                <div className="pathBar">정산 기록 〉 {historyYear}년</div>
                <div className="fileGrid">
                  {visibleRecords.map(([key, record]) => (
                    <button key={key} className="recordFile" onClick={() => { setData(record); setStep("result"); }}>
                      <span className="filePreview">
                        <i /><i /><i /><i />
                      </span>
                      <span><b>{record.month}월 관리비 정산</b><small>{lineName(record.line)} · {LINES[record.line].length}세대</small></span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {step !== "home" && step !== "history" && data && (
        <section className="workspace">
          {step !== "result" && (
            <div className="context">
              <div><span className="eyebrow">{lineName(data.line)}</span><h1>{data.year}년 {data.month}월 관리비 정산</h1></div>
              <div className="steps">
                {["수도 입력", "비용 입력", "정산 결과"].map((label, index) => {
                  const active = ["water", "fees", "result"].indexOf(step);
                  return <span key={label} className={index <= active ? "active" : ""}><i>{index + 1}</i>{label}</span>;
                })}
              </div>
            </div>
          )}

          {step === "water" && (
            <>
              <div className="sectionIntro"><div><span className="sectionNo">01</span><h2>수도 계량값 입력</h2></div><p>이번 달 계량값을 입력하면 사용량이 자동 계산됩니다.</p></div>
              <div className="tableCard inputTable"><table><thead><tr><th>호수</th><th>이전 달 계량</th><th>이번 달 계량</th><th>사용량</th></tr></thead>
                <tbody>{LINES[data.line].map((unit) => {
                  const entry = data.units[unit] || { previous: "", current: "", parking: "" };
                  const usage = Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
                  const invalid = entry.current !== "" && numberValue(entry.current) < numberValue(entry.previous);
                  return <tr key={unit}><th>{unit}호</th>
                    <td><input inputMode="decimal" value={entry.previous} onChange={(e) => updateUnit(unit, "previous", e.target.value)} placeholder="0" /></td>
                    <td><input className={invalid ? "invalid" : ""} inputMode="decimal" value={entry.current} onChange={(e) => updateUnit(unit, "current", e.target.value)} placeholder="입력" /></td>
                    <td><b>{entry.current ? `${money(usage)}톤` : "—"}</b></td></tr>;
                })}</tbody>
              </table></div>
              <div className="totalInput">
                <div><span>이번 달 전체 사용량</span><strong>{money(calculations.totalUsage)}톤</strong></div>
                <label><span>라인 총 수도요금</span><span className="moneyInput"><input inputMode="numeric" value={data.totalWaterBill} onChange={(e) => setData({ ...data, totalWaterBill: e.target.value })} placeholder="0" /><i>원</i></span></label>
              </div>
              <div className="nav"><button className="ghost" onClick={goHome}>이전</button><button className="primary" onClick={() => setStep("fees")}>비용 입력으로 →</button></div>
            </>
          )}

          {step === "fees" && (
            <>
              <div className="sectionIntro"><div><span className="sectionNo">02</span><h2>주차비 및 관리비 입력</h2></div><p>관리비는 모든 세대에 동일하게 적용됩니다.</p></div>
              <div className="feeLayout">
                <div className="tableCard inputTable"><table><thead><tr><th>호수</th><th>주차비</th></tr></thead>
                  <tbody>{LINES[data.line].map((unit) => {
                    const entry = data.units[unit] || { previous: "", current: "", parking: "" };
                    return <tr key={unit}><th>{unit}호</th><td><span className="inlineMoney"><input inputMode="numeric" value={entry.parking} onChange={(e) => updateUnit(unit, "parking", e.target.value)} placeholder="0" /><i>원</i></span></td></tr>;
                  })}</tbody>
                </table></div>
                <aside className="managementCard"><h3>공통 관리비</h3><p>입력한 금액이 {LINES[data.line].length}세대에 동일하게 적용됩니다.</p>
                  <span className="moneyInput large"><input inputMode="numeric" value={data.managementFee} onChange={(e) => setData({ ...data, managementFee: e.target.value })} /><i>원</i></span>
                  <small>전체 관리비 합계</small><strong>{money(numberValue(data.managementFee) * LINES[data.line].length)}원</strong>
                </aside>
              </div>
              <div className="nav"><button className="ghost" onClick={() => setStep("water")}>← 수도 입력</button><button className="primary" onClick={finish}>정산 결과 보기 →</button></div>
            </>
          )}

          {step === "result" && (
            <>
              <div className="resultTitle"><h2>{data.year}년 {data.month}월 관리비 정산</h2><p>{lineName(data.line)} · {LINES[data.line].length}세대</p></div>
              <div className="resultActions">
                <button className="ghost" onClick={openHistory}>정산 기록 보기</button>
                <button className="primary" onClick={() => downloadPng(data, calculations.rows)}>A4 결과표 PNG 저장</button>
              </div>
              <div className="tableCard resultTable"><table><thead><tr><th>호수</th><th>수도계량</th><th>사용량</th><th>수도요금</th><th>주차비</th><th>관리비</th><th>합계</th></tr></thead>
                <tbody>{calculations.rows.map((row) => <tr key={row.unit}><th>{row.unit}호</th><td>{money(numberValue(row.entry.current))}</td><td>{money(row.usage)}톤</td><td>{money(row.water)}원</td><td>{money(row.parking)}원</td><td>{money(row.management)}원</td><td><b>{money(row.total)}원</b></td></tr>)}</tbody>
              </table></div>
              <div className="nav"><button className="ghost" onClick={() => setStep("fees")}>← 수정하기</button><button className="primary" onClick={goHome}>메인으로</button></div>
            </>
          )}
        </section>
      )}

      {existingChoice && (
        <div className="modalBackdrop"><div className="modal" role="dialog" aria-modal="true">
          <h2>작성 중인 정산이 있습니다</h2><p>{year}년 {month}월 · {lineName(existingChoice)} 저장 내용을 찾았습니다.</p>
          <button className="primary full" onClick={() => begin("continue")}>이어서 작성하기</button>
          <button className="dangerText" onClick={() => begin("reset")}>새로 작성하고 덮어쓰기</button>
          <button className="close" onClick={() => setExistingChoice(null)}>×</button>
        </div></div>
      )}
    </main>
  );
}
