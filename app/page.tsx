"use client";

import { useEffect, useMemo, useState } from "react";

type LineKey = "12" | "34";
type Step = "home" | "water" | "waterRate" | "parkingFee" | "parkingUnits" | "management" | "remarks" | "treasurer" | "result" | "history";
type UnitEntry = { previous: string; current: string };
type Settlement = {
  year: number;
  month: number;
  units: Record<string, UnitEntry>;
  totalWaterBill: string;
  totalWaterBills?: Record<LineKey, string>;
  waterRate: string;
  waterRates?: Record<LineKey, string>;
  parkingFee: string;
  parkingUnits: Record<string, boolean>;
  managementFee: string;
  remarks: Record<string, string>;
  completed: boolean;
  updatedAt: string;
};
type LegacySettlement = {
  year: number;
  month: number;
  line: LineKey;
  units: Record<string, UnitEntry & { parking?: string }>;
  totalWaterBill: string;
  managementFee: string;
  completed: boolean;
  updatedAt: string;
};
type RecordEdit = { originalKey: string; year: number; month: number; record: Settlement };
type ResultRow = { unit: string; entry: UnitEntry; usage: number; water: number; parking: number; management: number; total: number };

const LINES: Record<LineKey, string[]> = {
  "12": ["101", "102", "201", "202", "301", "302", "501", "502"],
  "34": ["103", "104", "203", "204", "303", "304", "503", "504"],
};
const LINE_KEYS: LineKey[] = ["12", "34"];
const ALL_UNITS = LINE_KEYS.flatMap((line) => LINES[line]).sort((a, b) => Number(a) - Number(b));
const STORAGE_KEY = "building-fee-settlements-v2";
const LEGACY_STORAGE_KEY = "building-fee-settlements-v1";
const RECENT_RECORD_KEY = "building-fee-recent-record-v1";

const money = (value: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(Math.round(value));
const numberValue = (value: string | undefined) => {
  const parsed = Number((value || "").replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
};
const settlementKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const lineName = (line: LineKey) => (line === "12" ? "1·2호 라인" : "3·4호 라인");
const emptyEntry = (): UnitEntry => ({ previous: "", current: "" });

function migrateLegacy(): Record<string, Settlement> {
  if (typeof window === "undefined") return {};
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "{}") as Record<string, LegacySettlement>;
    const migrated: Record<string, Settlement> = {};
    Object.values(legacy).forEach((old) => {
      const key = settlementKey(old.year, old.month);
      const current = migrated[key] || {
        year: old.year,
        month: old.month,
        units: Object.fromEntries(ALL_UNITS.map((unit) => [unit, emptyEntry()])),
        totalWaterBills: { "12": "", "34": "" },
        totalWaterBill: "",
        waterRate: "",
        waterRates: { "12": "", "34": "" },
        parkingFee: "10000",
        parkingUnits: {},
        managementFee: old.managementFee || "20000",
        remarks: {},
        completed: false,
        updatedAt: old.updatedAt || new Date().toISOString(),
      };
      LINES[old.line].forEach((unit) => {
        const entry = old.units[unit];
        current.units[unit] = { previous: entry?.previous || "", current: entry?.current || "" };
        if (numberValue(entry?.parking) > 0) {
          current.parkingUnits[unit] = true;
          current.parkingFee = entry?.parking || current.parkingFee;
        }
      });
      current.totalWaterBills![old.line] = old.totalWaterBill || "";
      current.totalWaterBill = String(numberValue(current.totalWaterBill) + numberValue(old.totalWaterBill));
      current.managementFee = old.managementFee || current.managementFee;
      current.completed = current.completed || old.completed;
      if (old.updatedAt > current.updatedAt) current.updatedAt = old.updatedAt;
      migrated[key] = current;
    });
    if (Object.keys(migrated).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
    return migrated;
  } catch {
    return {};
  }
}

function readAll(): Record<string, Settlement> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : migrateLegacy();
  } catch {
    return {};
  }
}

function previousPeriod(year: number, month: number) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function blankSettlement(year: number, month: number): Settlement {
  const prev = previousPeriod(year, month);
  const previous = readAll()[settlementKey(prev.year, prev.month)];
  return {
    year,
    month,
    units: Object.fromEntries(ALL_UNITS.map((unit) => [unit, { previous: previous?.units[unit]?.current || "", current: "" }])),
    totalWaterBill: "",
    waterRate: "",
    parkingFee: previous?.parkingFee || "10000",
    parkingUnits: Object.fromEntries(ALL_UNITS.map((unit) => [unit, previous?.parkingUnits[unit] || false])),
    managementFee: previous?.managementFee || "20000",
    remarks: {},
    completed: false,
    updatedAt: new Date().toISOString(),
  };
}

function calculateLine(settlement: Settlement | null, line: LineKey) {
  if (!settlement) return { rows: [] as ResultRow[], totalUsage: 0 };
  const raw = LINES[line].map((unit) => {
    const entry = settlement.units[unit] || emptyEntry();
    return { unit, entry, usage: Math.max(0, numberValue(entry.current) - numberValue(entry.previous)) };
  });
  const totalUsage = raw.reduce((sum, row) => sum + row.usage, 0);
  const combinedUsage = ALL_UNITS.reduce((sum, unit) => {
    const entry = settlement.units[unit] || emptyEntry();
    return sum + Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
  }, 0);
  const combinedBill = numberValue(settlement.totalWaterBill) || LINE_KEYS.reduce((sum, key) => sum + numberValue(settlement.totalWaterBills?.[key]), 0);
  const waterRate = numberValue(settlement.waterRate) || (combinedUsage > 0 ? combinedBill / combinedUsage : 0);
  const management = numberValue(settlement.managementFee);
  const parkingFee = numberValue(settlement.parkingFee);
  const rows = raw.map((row) => {
    const water = Math.round(row.usage * waterRate);
    const parking = settlement.parkingUnits[row.unit] ? parkingFee : 0;
    return { ...row, water, parking, management, total: water + parking + management };
  });
  return { rows, totalUsage };
}

function makePng(settlement: Settlement, line: LineKey, rows: ResultRow[], treasurer = false) {
  const canvas = document.createElement("canvas");
  const width = 2480;
  const height = 3508;
  const margin = 40;
  const tableY = 340;
  const headerHeight = 216;
  const rowHeight = 312;
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.font = "900 114px Arial, sans-serif";
  ctx.fillText(`${settlement.year}년 ${settlement.month}월 관리비 정산`, width / 2, 130);
  ctx.font = "900 64px Arial, sans-serif";
  ctx.fillText(lineName(line), width / 2, 242);
  const headers = ["호수", "수도계량", "사용량", "수도요금", "주차비", "관리비", "합계", "비고"];
  const columnWidths = [230, 330, 270, 350, 300, 300, 380, 240];
  const drawCell = (x: number, y: number, w: number, h: number, value: string, header = false) => {
    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 10;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    let size = 84;
    const minimum = header ? 62 : 52;
    ctx.font = `900 ${size}px Arial, sans-serif`;
    while (ctx.measureText(value).width > w - 30 && size > minimum) {
      size -= 2;
      ctx.font = `900 ${size}px Arial, sans-serif`;
    }
    ctx.fillText(value, x + w / 2, y + h / 2);
  };
  let x = margin;
  headers.forEach((header, index) => {
    drawCell(x, tableY, columnWidths[index], headerHeight, header, true);
    x += columnWidths[index];
  });
  rows.forEach((row, rowIndex) => {
    const values = [`${row.unit}호`, money(numberValue(row.entry.current)), money(row.usage), money(row.water), money(row.parking), money(row.management), money(row.total), settlement.remarks?.[row.unit] || ""];
    x = margin;
    values.forEach((value, index) => {
      drawCell(x, tableY + headerHeight + rowHeight * rowIndex, columnWidths[index], rowHeight, value);
      x += columnWidths[index];
    });
  });
  if (treasurer) {
    const totals = ["합계", "", money(rows.reduce((sum, row) => sum + row.usage, 0)), money(rows.reduce((sum, row) => sum + row.water, 0)), money(rows.reduce((sum, row) => sum + row.parking, 0)), money(rows.reduce((sum, row) => sum + row.management, 0)), money(rows.reduce((sum, row) => sum + row.total, 0)), ""];
    x = margin;
    totals.forEach((value, index) => {
      drawCell(x, tableY + headerHeight + rowHeight * rows.length, columnWidths[index], 180, value, true);
      x += columnWidths[index];
    });
  }
  const totalUsage = rows.reduce((sum, row) => sum + row.usage, 0);
  const combinedUsage = ALL_UNITS.reduce((sum, unit) => {
    const entry = settlement.units[unit] || emptyEntry();
    return sum + Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
  }, 0);
  const combinedBill = numberValue(settlement.totalWaterBill) || LINE_KEYS.reduce((sum, key) => sum + numberValue(settlement.totalWaterBills?.[key]), 0);
  const appliedRate = numberValue(settlement.waterRate) || (combinedUsage ? combinedBill / combinedUsage : 0);
  const footer = `수도요금 ${money(combinedBill)}원 ÷ ${money(combinedUsage)}톤 = ${money(appliedRate)}원`;
  ctx.font = "900 78px Arial, sans-serif";
  ctx.fillText(footer, width / 2, treasurer ? 3290 : 3210);
  ctx.fillText("새마을금고 9002205515741 최영옥", width / 2, treasurer ? 3420 : 3340);
  return canvas.toDataURL("image/png");
}

function downloadLine(settlement: Settlement, line: LineKey, rows: ResultRow[], treasurer = false) {
  const href = makePng(settlement, line, rows, treasurer);
  if (!href) return;
  const link = document.createElement("a");
  link.download = `${settlement.year}-${String(settlement.month).padStart(2, "0")}-${line}-${treasurer ? "총무용-" : ""}관리비정산.png`;
  link.href = href;
  link.click();
}

function SettlementSheet({ settlement, line, rows, treasurer = false }: { settlement: Settlement; line: LineKey; rows: ResultRow[]; treasurer?: boolean }) {
  const combinedUsage = ALL_UNITS.reduce((sum, unit) => {
    const entry = settlement.units[unit] || emptyEntry();
    return sum + Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
  }, 0);
  const totalBill = numberValue(settlement.totalWaterBill) || LINE_KEYS.reduce((sum, key) => sum + numberValue(settlement.totalWaterBills?.[key]), 0);
  const appliedRate = numberValue(settlement.waterRate) || (combinedUsage ? totalBill / combinedUsage : 0);
  return <article className="printSheet"><div className="sheetTitle"><h3>{settlement.year}년 {settlement.month}월 관리비 정산</h3><p>{lineName(line)}</p></div><div className="tableCard resultTable"><table><thead><tr><th>호수</th><th>수도계량</th><th>사용량</th><th>수도요금</th><th>주차비</th><th>관리비</th><th>합계</th><th>비고</th></tr></thead><tbody>{rows.map((row) => <tr key={row.unit}><th>{row.unit}호</th><td>{money(numberValue(row.entry.current))}</td><td>{money(row.usage)}톤</td><td>{money(row.water)}원</td><td>{money(row.parking)}원</td><td>{money(row.management)}원</td><td><b>{money(row.total)}원</b></td><td>{settlement.remarks?.[row.unit] || ""}</td></tr>)}{treasurer && <tr className="totalRow"><th>합계</th><td>—</td><td>{money(rows.reduce((sum, row) => sum + row.usage, 0))}톤</td><td>{money(rows.reduce((sum, row) => sum + row.water, 0))}원</td><td>{money(rows.reduce((sum, row) => sum + row.parking, 0))}원</td><td>{money(rows.reduce((sum, row) => sum + row.management, 0))}원</td><td>{money(rows.reduce((sum, row) => sum + row.total, 0))}원</td><td /></tr>}</tbody></table></div><footer className="sheetFooter"><b>수도요금 {money(totalBill)}원 ÷ {money(combinedUsage)}톤 = {money(appliedRate)}원</b><strong>새마을금고 9002205515741 최영옥</strong></footer></article>;
}

export default function Home() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [step, setStep] = useState<Step>("home");
  const [data, setData] = useState<Settlement | null>(null);
  const [existing, setExisting] = useState(false);
  const [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<Record<string, Settlement>>({});
  const [historyYear, setHistoryYear] = useState<number | null>(null);
  const [recordEdit, setRecordEdit] = useState<RecordEdit | null>(null);
  const [recentRecordKey, setRecentRecordKey] = useState<string | null>(null);

  useEffect(() => {
    if (!data || step === "home" || step === "history") return;
    setSaved(false);
    const timer = window.setTimeout(() => {
      const all = readAll();
      all[settlementKey(data.year, data.month)] = { ...data, updatedAt: new Date().toISOString() };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
      setSaved(true);
      setHistory(all);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [data, step]);

  const calculations = useMemo(() => ({ "12": calculateLine(data, "12"), "34": calculateLine(data, "34") }), [data]);
  const completedRecords = useMemo(() => Object.entries(history).filter(([, record]) => record.completed).sort(([, a], [, b]) => b.year - a.year || b.month - a.month), [history]);
  const historyYears = useMemo(() => Array.from(new Set(completedRecords.map(([, record]) => record.year))).sort((a, b) => b - a), [completedRecords]);
  const visibleRecords = completedRecords.filter(([, record]) => historyYear === null || record.year === historyYear);
  const activeIndex = ["water", "waterRate", "parkingFee", "parkingUnits", "management", "remarks", "treasurer", "result"].indexOf(step);

  const startSettlement = () => {
    const found = readAll()[settlementKey(year, month)];
    if (found) setExisting(true);
    else {
      setData(blankSettlement(year, month));
      setStep("water");
    }
  };
  const begin = (mode: "continue" | "reset") => {
    const key = settlementKey(year, month);
    setData(mode === "continue" ? readAll()[key] : blankSettlement(year, month));
    setExisting(false);
    setStep("water");
  };
  const updateUnit = (unit: string, field: keyof UnitEntry, value: string) => setData((current) => current ? { ...current, units: { ...current.units, [unit]: { ...(current.units[unit] || emptyEntry()), [field]: value } } } : current);
  const goHome = () => { setStep("home"); setData(null); setExisting(false); };
  const openHistory = () => {
    const all = readAll();
    setHistory(all);
    setRecentRecordKey(localStorage.getItem(RECENT_RECORD_KEY));
    const years = Array.from(new Set(Object.values(all).filter((item) => item.completed).map((item) => item.year))).sort((a, b) => b - a);
    setHistoryYear(years[0] || null);
    setStep("history");
  };
  const markRecentRecord = (key: string) => {
    localStorage.setItem(RECENT_RECORD_KEY, key);
    setRecentRecordKey(key);
  };
  const finish = () => { setData((current) => current ? { ...current, completed: true } : current); setStep("result"); };
  const openWaterRate = () => {
    setData((current) => {
      if (!current) return current;
      if (current.waterRate) return current;
      const totalUsage = LINE_KEYS.reduce((sum, line) => sum + calculateLine(current, line).totalUsage, 0);
      const totalBill = numberValue(current.totalWaterBill) || LINE_KEYS.reduce((sum, line) => sum + numberValue(current.totalWaterBills?.[line]), 0);
      const waterRate = totalUsage > 0 ? String(Math.round((totalBill / totalUsage) * 100) / 100) : "0";
      return { ...current, waterRate };
    });
    setStep("waterRate");
  };
  const saveRecordDate = () => {
    if (!recordEdit) return;
    const nextKey = settlementKey(recordEdit.year, recordEdit.month);
    const all = readAll();
    if (nextKey !== recordEdit.originalKey && all[nextKey]) {
      window.alert("같은 연도와 월의 정산 기록이 이미 있습니다.");
      return;
    }
    const updated = { ...recordEdit.record, year: recordEdit.year, month: recordEdit.month, updatedAt: new Date().toISOString() };
    delete all[recordEdit.originalKey];
    all[nextKey] = updated;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    setHistory(all);
    setHistoryYear(updated.year);
    markRecentRecord(nextKey);
    setRecordEdit(null);
  };
  const deleteRecord = (key: string, record: Settlement) => {
    if (!window.confirm(`${record.year}년 ${record.month}월 정산표를 삭제할까요?\n두 라인의 기록이 함께 삭제되며 복구할 수 없습니다.`)) return;
    const all = readAll();
    delete all[key];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    if (recentRecordKey === key) {
      localStorage.removeItem(RECENT_RECORD_KEY);
      setRecentRecordKey(null);
    }
    setHistory(all);
    const remainingYears = Array.from(new Set(Object.values(all).filter((item) => item.completed).map((item) => item.year))).sort((a, b) => b - a);
    if (!remainingYears.includes(historyYear ?? -1)) setHistoryYear(remainingYears[0] || null);
  };
  const downloadBoth = () => {
    if (!data) return;
    downloadLine(data, "12", calculations["12"].rows);
    window.setTimeout(() => downloadLine(data, "34", calculations["34"].rows), 250);
  };
  const downloadTreasurerBoth = () => {
    if (!data) return;
    downloadLine(data, "12", calculations["12"].rows, true);
    window.setTimeout(() => downloadLine(data, "34", calculations["34"].rows, true), 250);
  };

  return <main>
    <header className="topbar">
      <button className="brand" onClick={goHome}>관리비 계산기</button>
      {step !== "home" && <div className="headerActions">
        {step !== "history" && <span className={`saveState ${saved ? "saved" : ""}`}><i />{saved ? "자동 저장됨" : "저장 중"}</span>}
        <button className="ghost compact" onClick={goHome}>메인</button>
      </div>}
    </header>

    {step === "home" && <section className="home">
      <h1>관리비 계산기</h1>
      <div className="homeTools"><button className="historyButton" onClick={openHistory}><span className="folderIcon">▣</span><span><b>정산 기록 보기</b><small>연도·월별 완료된 정산표</small></span><span>→</span></button></div>
      <div className="datePanel">
        <label><span>정산 연도</span><select value={year} onChange={(event) => setYear(Number(event.target.value))}>{Array.from({ length: 9 }, (_, index) => today.getFullYear() - 4 + index).map((value) => <option key={value}>{value}</option>)}</select></label>
        <label><span>정산 월</span><select value={month} onChange={(event) => setMonth(Number(event.target.value))}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value}>{value}</option>)}</select></label>
      </div>
      <button className="primary startButton" onClick={startSettlement}>16세대 정산 시작하기 →</button>
      <p className="privacy">두 라인을 한 번에 입력하고, 결과표는 라인별로 나누어 저장합니다.</p>
    </section>}

    {step === "history" && <section className="historyPage">
      <div className="historyHeading"><div><h1>정산 기록</h1><p>완료된 두 라인의 정산표를 월별로 함께 관리합니다.</p></div><button className="primary" onClick={goHome}>새 정산 만들기</button></div>
      {completedRecords.length === 0 ? <div className="emptyHistory"><b>저장된 정산 기록이 없습니다.</b><p>정산을 완료하면 이곳에 자동으로 표시됩니다.</p></div> : <div className="explorer">
        <aside className="yearFolders"><h2>연도</h2>{historyYears.map((item) => <button key={item} className={historyYear === item ? "selected" : ""} onClick={() => setHistoryYear(item)}><span>▰</span>{item}년</button>)}</aside>
        <div className="monthFiles"><div className="pathBar">정산 기록 〉 {historyYear}년</div><div className="fileGrid">{visibleRecords.map(([key, record]) => <article key={key} className={`recordFile ${recentRecordKey === key ? "recentRecord" : ""}`}>
          {recentRecordKey === key && <span className="recentBadge">최근 확인</span>}
          <button className="recordOpen" onClick={() => { markRecentRecord(key); setData(record); setStep("result"); }} aria-label={`${record.year}년 ${record.month}월 정산표 열기`}><span className="filePreview"><i /><i /><i /><i /></span><span><b>{record.month}월 관리비 정산</b><small>1·2호 / 3·4호 라인 · 총 16세대</small></span></button>
          <div className="recordActions"><button onClick={() => setRecordEdit({ originalKey: key, year: record.year, month: record.month, record })}>연·월 수정</button><button className="deleteRecord" onClick={() => deleteRecord(key, record)}>삭제</button></div>
        </article>)}</div></div>
      </div>}
    </section>}

    {step !== "home" && step !== "history" && data && <section className="workspace">
      {step !== "result" && step !== "treasurer" && <div className="context"><div><span className="eyebrow">전체 16세대</span><h1>{data.year}년 {data.month}월 관리비 정산</h1></div><div className="steps">{["수도", "단가", "주차비", "주차 호수", "관리비", "비고", "총무용", "결과"].map((label, index) => <span key={label} className={index <= activeIndex ? "active" : ""}><i>{index + 1}</i>{label}</span>)}</div></div>}

      {step === "water" && <>
        <div className="sectionIntro"><div><span className="sectionNo">01</span><h2>전체 수도 계량값 입력</h2></div><p>두 라인 16세대를 한 번에 입력합니다.</p></div>
        {LINE_KEYS.map((line) => <div className="lineInputGroup" key={line}><h3>{lineName(line)}</h3><div className="tableCard inputTable"><table><thead><tr><th>호수</th><th>이전 달 계량</th><th>이번 달 계량</th><th>사용량</th></tr></thead><tbody>{LINES[line].map((unit) => {
          const entry = data.units[unit] || emptyEntry();
          const usage = Math.max(0, numberValue(entry.current) - numberValue(entry.previous));
          const invalid = entry.current !== "" && numberValue(entry.current) < numberValue(entry.previous);
          return <tr key={unit}><th>{unit}호</th><td><input inputMode="decimal" value={entry.previous} onChange={(event) => updateUnit(unit, "previous", event.target.value)} placeholder="0" /></td><td><input className={invalid ? "invalid" : ""} inputMode="decimal" value={entry.current} onChange={(event) => updateUnit(unit, "current", event.target.value)} placeholder="입력" /></td><td><b>{entry.current ? `${money(usage)}톤` : "—"}</b></td></tr>;
        })}</tbody></table></div></div>)}
        <div className="usageTotals">
          <div><span>1·2호 라인 전체 사용량</span><strong>{money(calculations["12"].totalUsage)}톤</strong></div>
          <div><span>3·4호 라인 전체 사용량</span><strong>{money(calculations["34"].totalUsage)}톤</strong></div>
          <div className="allLinesUsage"><span>두 라인 총사용량</span><strong>{money(calculations["12"].totalUsage + calculations["34"].totalUsage)}톤</strong></div>
        </div>
        <div className="totalInput combinedBillInput"><label><span>전체 총수도요금</span><span className="moneyInput"><input inputMode="numeric" value={data.totalWaterBill || ""} onChange={(event) => setData({ ...data, totalWaterBill: event.target.value, waterRate: "" })} placeholder="0" /><i>원</i></span></label></div>
        <div className="nav"><button className="ghost" onClick={goHome}>이전</button><button className="primary" onClick={openWaterRate}>수도요금 단가 확인 →</button></div>
      </>}

      {step === "waterRate" && <div className="focusedStep"><div className="sectionIntro"><div><span className="sectionNo">02</span><h2>톤당 수도요금 확인</h2></div><p>두 라인을 합친 총사용량으로 공통 단가를 계산합니다.</p></div><div className="combinedUsageCards"><div className="combinedTotal"><span>두 라인 총사용량</span><strong>{money(calculations["12"].totalUsage + calculations["34"].totalUsage)}톤</strong></div></div><section className="rateCard sharedRateCard"><h3>전체 공통 수도요금 단가</h3><div className="rateFormula"><span>전체 총수도요금</span><b>{money(numberValue(data.totalWaterBill))}원</b><i>÷</i><span>두 라인 총사용량</span><b>{money(calculations["12"].totalUsage + calculations["34"].totalUsage)}톤</b></div><p>자동 계산 단가 <strong>{money((calculations["12"].totalUsage + calculations["34"].totalUsage) > 0 ? numberValue(data.totalWaterBill) / (calculations["12"].totalUsage + calculations["34"].totalUsage) : 0)}원/톤</strong></p><label><span>16세대에 적용할 1톤당 수도요금</span><span className="moneyInput large"><input inputMode="decimal" value={data.waterRate || ""} onChange={(event) => setData({ ...data, waterRate: event.target.value })} /><i>원</i></span></label><small>모든 호수의 수도요금은 사용량 × 이 공통 단가로 계산됩니다.</small></section><div className="nav"><button className="ghost" onClick={() => setStep("water")}>← 수도 입력</button><button className="primary" onClick={() => setStep("parkingFee")}>주차비 설정으로 →</button></div></div>}

      {step === "parkingFee" && <div className="focusedStep"><div className="sectionIntro"><div><span className="sectionNo">03</span><h2>주차비 금액 설정</h2></div></div><div className="singleSettingCard"><p>주차비를 내는 세대마다 적용할 금액입니다. 기본값은 10,000원이며 언제든 바꿀 수 있습니다.</p><label><span>세대당 주차비</span><span className="moneyInput large"><input autoFocus inputMode="numeric" value={data.parkingFee} onChange={(event) => setData({ ...data, parkingFee: event.target.value })} /><i>원</i></span></label></div><div className="nav"><button className="ghost" onClick={() => setStep("waterRate")}>← 수도요금 단가</button><button className="primary" onClick={() => setStep("parkingUnits")}>납부 호수 선택 →</button></div></div>}

      {step === "parkingUnits" && <div className="focusedStep"><div className="sectionIntro"><div><span className="sectionNo">03</span><h2>주차비 납부 호수 선택</h2></div><p>체크 상태는 다음 달 정산에도 그대로 이어집니다.</p></div><div className="parkingPicker">{LINE_KEYS.map((line) => <fieldset key={line}><legend>{lineName(line)}</legend><div className="unitChecks">{LINES[line].map((unit) => <label key={unit} className={data.parkingUnits[unit] ? "checked" : ""}><input type="checkbox" checked={data.parkingUnits[unit] || false} onChange={(event) => setData({ ...data, parkingUnits: { ...data.parkingUnits, [unit]: event.target.checked } })} /><span>{unit}호</span><small>{data.parkingUnits[unit] ? `${money(numberValue(data.parkingFee))}원` : "미납부"}</small></label>)}</div></fieldset>)}</div><p className="selectionSummary">총 <b>{ALL_UNITS.filter((unit) => data.parkingUnits[unit]).length}세대</b> · 주차비 합계 <b>{money(ALL_UNITS.filter((unit) => data.parkingUnits[unit]).length * numberValue(data.parkingFee))}원</b></p><div className="nav"><button className="ghost" onClick={() => setStep("parkingFee")}>← 주차비 금액</button><button className="primary" onClick={() => setStep("management")}>관리비 설정 →</button></div></div>}

      {step === "management" && <div className="focusedStep"><div className="sectionIntro"><div><span className="sectionNo">05</span><h2>공통 관리비 설정</h2></div></div><div className="singleSettingCard"><p>입력한 금액이 전체 16세대에 동일하게 적용됩니다.</p><label><span>세대당 관리비</span><span className="moneyInput large"><input inputMode="numeric" value={data.managementFee} onChange={(event) => setData({ ...data, managementFee: event.target.value })} /><i>원</i></span></label><small>전체 관리비 합계</small><strong>{money(numberValue(data.managementFee) * ALL_UNITS.length)}원</strong></div><div className="nav"><button className="ghost" onClick={() => setStep("parkingUnits")}>← 주차 호수</button><button className="primary" onClick={() => setStep("remarks")}>비고 작성 →</button></div></div>}

      {step === "remarks" && <><div className="sectionIntro"><div><span className="sectionNo">06</span><h2>비고 작성</h2></div><p>비고만 수정할 수 있으며 모든 출력물에 반영됩니다.</p></div><div className="remarksTables">{LINE_KEYS.map((line) => <section key={line}><h3>{lineName(line)}</h3><div className="tableCard resultTable"><table><thead><tr><th>호수</th><th>수도계량</th><th>사용량</th><th>수도요금</th><th>주차비</th><th>관리비</th><th>합계</th><th>비고</th></tr></thead><tbody>{calculations[line].rows.map((row) => <tr key={row.unit}><th>{row.unit}호</th><td>{money(numberValue(row.entry.current))}</td><td>{money(row.usage)}톤</td><td>{money(row.water)}원</td><td>{money(row.parking)}원</td><td>{money(row.management)}원</td><td><b>{money(row.total)}원</b></td><td><input className="remarkInput" value={data.remarks?.[row.unit] || ""} onChange={(event) => setData({ ...data, remarks: { ...(data.remarks || {}), [row.unit]: event.target.value } })} placeholder="비고 입력" /></td></tr>)}</tbody></table></div></section>)}</div><div className="nav"><button className="ghost" onClick={() => setStep("management")}>← 관리비</button><button className="primary" onClick={() => setStep("treasurer")}>총무용 표 확인 →</button></div></>}

      {step === "treasurer" && <><div className="resultTitle"><h2>총무용 정산표</h2><p>라인별 합계가 포함된 내부 확인용 표입니다.</p></div><div className="resultActions"><button className="primary" onClick={downloadTreasurerBoth}>총무용 결과표 2장 저장</button></div><div className="sheetCarousel">{LINE_KEYS.map((line) => <SettlementSheet key={line} settlement={data} line={line} rows={calculations[line].rows} treasurer />)}</div><div className="nav"><button className="ghost" onClick={() => setStep("remarks")}>← 비고 수정</button><button className="primary" onClick={finish}>주민용 최종 표 →</button></div></>}

      {step === "result" && <><div className="resultTitle"><h2>{data.year}년 {data.month}월 관리비 정산</h2><p>주민용 결과표 2장을 옆으로 넘겨 확인하세요.</p></div><div className="resultActions"><button className="ghost" onClick={openHistory}>정산 기록 보기</button><button className="primary" onClick={downloadBoth}>결과표 2장 모두 저장</button></div><div className="sheetCarousel">{LINE_KEYS.map((line) => <SettlementSheet key={line} settlement={data} line={line} rows={calculations[line].rows} />)}</div><div className="nav"><button className="ghost" onClick={() => setStep("treasurer")}>← 총무용 표</button><button className="primary" onClick={goHome}>메인으로</button></div></>}
    </section>}

    {existing && <div className="modalBackdrop"><div className="modal" role="dialog" aria-modal="true"><h2>작성 중인 정산이 있습니다</h2><p>{year}년 {month}월 저장 내용을 찾았습니다.</p><button className="primary full" onClick={() => begin("continue")}>이어서 작성하기</button><button className="dangerText" onClick={() => begin("reset")}>새로 작성하고 덮어쓰기</button><button className="close" onClick={() => setExisting(false)} aria-label="닫기">×</button></div></div>}
    {recordEdit && <div className="modalBackdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setRecordEdit(null); }}><div className="modal editRecordModal" role="dialog" aria-modal="true" aria-labelledby="edit-record-title"><h2 id="edit-record-title">정산 연·월 수정</h2><p>두 라인의 정산 날짜를 함께 변경합니다.</p><div className="editDateFields"><label><span>정산 연도</span><input type="number" min="2000" max="2100" value={recordEdit.year} onChange={(event) => setRecordEdit({ ...recordEdit, year: Number(event.target.value) })} /></label><label><span>정산 월</span><select value={recordEdit.month} onChange={(event) => setRecordEdit({ ...recordEdit, month: Number(event.target.value) })}>{Array.from({ length: 12 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}월</option>)}</select></label></div><div className="modalActions"><button className="ghost" onClick={() => setRecordEdit(null)}>취소</button><button className="primary" onClick={saveRecordDate} disabled={recordEdit.year < 2000 || recordEdit.year > 2100}>저장</button></div><button className="close" onClick={() => setRecordEdit(null)} aria-label="닫기">×</button></div></div>}
  </main>;
}
