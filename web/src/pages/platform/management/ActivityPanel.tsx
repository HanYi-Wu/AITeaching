import { useEffect, useRef, useState } from "react";
import type { PlatformUser } from "../../../platform/authTypes";
import { loadSessionToken } from "../../../platform/session";
import {
  getManagementActivity,
  getManagementOptions,
  type ManagementActivity,
  type ManagementScope,
} from "../../../platform/managementApi";
import "./ActivityPanel.css";

type Props = { user: PlatformUser; scope: ManagementScope };
type SchoolOption = { school_id: string; school_name: string };
type LoadState = "loading" | "ready" | "error";
const DAY_CHOICES = [7, 30, 90] as const;
const SCHOOL_PAGE_SIZE = 20;

function validDays(value: number | undefined): 7 | 30 | 90 {
  return value === 7 || value === 90 ? value : 30;
}

function cellLevel(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  const ratio = value / max;
  if (ratio >= 0.75) return 4;
  if (ratio >= 0.5) return 3;
  if (ratio >= 0.25) return 2;
  return 1;
}

function Heatmap({ activity, page, onPageChange }: { activity: ManagementActivity; page: number; onPageChange: (value: number) => void }) {
  const maximum = Math.max(0, ...activity.heatmap.matrix.flat());
  const { rows, columns, matrix } = activity.heatmap;
  const pageCount = Math.max(1, Math.ceil(rows.length / SCHOOL_PAGE_SIZE));
  const activePage = Math.min(page, pageCount - 1);
  const firstIndex = activePage * SCHOOL_PAGE_SIZE;
  const visibleRows = rows.slice(firstIndex, firstIndex + SCHOOL_PAGE_SIZE);

  return (
    <div className="management-activity__heatmap-wrap">
      {rows.length > SCHOOL_PAGE_SIZE ? (
        <div className="management-activity__heatmap-pages" role="group" aria-label="热力图学校分页">
          <span>显示 {firstIndex + 1}–{Math.min(firstIndex + SCHOOL_PAGE_SIZE, rows.length)} / {rows.length} 所学校</span>
          <div>
            <button type="button" onClick={() => onPageChange(Math.max(0, activePage - 1))} disabled={activePage === 0}>上一页</button>
            <span aria-live="polite">第 {activePage + 1} / {pageCount} 页</span>
            <button type="button" onClick={() => onPageChange(Math.min(pageCount - 1, activePage + 1))} disabled={activePage + 1 >= pageCount}>下一页</button>
          </div>
        </div>
      ) : null}
      <div className="management-activity__table-scroll">
      <table className="management-activity__heatmap" style={{ minWidth: `calc(var(--activity-school-width) + ${columns.length} * var(--activity-day-width))` }} aria-label="按学校和日期统计的管理活动热力图">
          <thead>
            <tr>
              <th className="management-activity__school-heading" scope="col">学校</th>
              {columns.map((day) => (
                <th key={day} scope="col" aria-label={day} title={day}>
                  <time dateTime={day}>{day.slice(5)}</time>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((school, visibleIndex) => {
              const rowIndex = firstIndex + visibleIndex;
              return (
                <tr key={school.school_id}>
                  <th scope="row" className="management-activity__school-name">{school.school_name}</th>
                  {columns.map((day, columnIndex) => {
                    const count = matrix[rowIndex]?.[columnIndex] ?? 0;
                    return (
                      <td
                        key={`${school.school_id}:${day}`}
                        className={`management-activity__cell management-activity__cell--${cellLevel(count, maximum)}`}
                        aria-label={`${school.school_name}，${day}，${count} 次管理操作`}
                        title={`${school.school_name} · ${day} · ${count} 次管理操作`}
                      >
                        {count > 0 ? count : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length === 0 ? <p className="management-activity__empty-schools">暂无学校</p> : null}
    </div>
  );
}

export function ActivityPanel({ user, scope }: Props) {
  const sessionToken = loadSessionToken();
  const identity = `${scope}:${user.id}:${user.school_id ?? ""}:${sessionToken ?? ""}`;
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const sessionTokenRef = useRef(sessionToken);
  sessionTokenRef.current = sessionToken;
  const mountedRef = useRef(false);
  const activityRequestRef = useRef(0);
  const optionsRequestRef = useRef(0);
  const daysTouchedRef = useRef(false);
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [schoolOptions, setSchoolOptions] = useState<SchoolOption[]>([]);
  const [activity, setActivity] = useState<ManagementActivity>();
  const [schoolPage, setSchoolPage] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activityRequestRef.current += 1;
      optionsRequestRef.current += 1;
    };
  }, []);

  useEffect(() => {
    daysTouchedRef.current = false;
    setDays(30);
    setSelectedSchoolId("");
    setSchoolOptions([]);
    setActivity(undefined);
    setLoadState("loading");
  }, [identity]);

  useEffect(() => {
    const requestId = ++optionsRequestRef.current;
    void getManagementOptions(scope)
      .then(({ settings }) => {
        if (
          mountedRef.current
          && optionsRequestRef.current === requestId
          && identityRef.current === identity
          && loadSessionToken() === sessionTokenRef.current
          && !daysTouchedRef.current
        ) {
          setDays(validDays(settings.activity_default_days));
        }
      })
      .catch(() => {
        // Activity remains available with the built-in 30 day default.
      });
    return () => {
      if (optionsRequestRef.current === requestId) optionsRequestRef.current += 1;
    };
  }, [identity, scope]);

  useEffect(() => {
    const requestId = ++activityRequestRef.current;
    setLoadState("loading");
    setActivity(undefined);
    const params = scope === "admin"
      ? { days, ...(selectedSchoolId ? { school_id: selectedSchoolId } : {}) }
      : { days };
    void getManagementActivity(scope, params)
      .then((result) => {
        if (!mountedRef.current || activityRequestRef.current !== requestId || identityRef.current !== identity || loadSessionToken() !== sessionTokenRef.current) return;
        setActivity(result);
        if (scope === "admin" && !selectedSchoolId) setSchoolOptions(result.schools);
        setSchoolPage(0);
        setLoadState("ready");
      })
      .catch(() => {
        if (!mountedRef.current || activityRequestRef.current !== requestId || identityRef.current !== identity || loadSessionToken() !== sessionTokenRef.current) return;
        setLoadState("error");
      });
    return () => {
      if (activityRequestRef.current === requestId) activityRequestRef.current += 1;
    };
  }, [days, identity, retryToken, scope, selectedSchoolId]);

  const retry = () => setRetryToken((value) => value + 1);
  const visibleIdentityMatchesSession = loadSessionToken() === sessionToken;

  return (
    <section className="management-activity management-panel" aria-labelledby="management-activity-title">
      <header className="management-activity__header">
        <div>
          <h2 id="management-activity-title">管理活动</h2>
        </div>
        <div className="management-activity__filters">
          <label>
            <span>统计周期</span>
            <select
              aria-label="统计周期"
              value={days}
              onChange={(event) => {
                daysTouchedRef.current = true;
                setDays(validDays(Number(event.currentTarget.value)));
              }}
            >
              {DAY_CHOICES.map((choice) => <option key={choice} value={choice}>近 {choice} 天</option>)}
            </select>
          </label>
          {scope === "admin" ? (
            <label>
              <span>学校范围</span>
              <select
                aria-label="学校范围"
                value={selectedSchoolId}
                onChange={(event) => setSelectedSchoolId(event.currentTarget.value)}
              >
                <option value="">全部学校</option>
                {schoolOptions.map((school) => (
                  <option key={school.school_id} value={school.school_id}>{school.school_name}</option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </header>

      {!visibleIdentityMatchesSession || loadState === "loading" ? (
        <div className="management-activity__state" role="status" aria-live="polite">正在加载管理活动…</div>
      ) : loadState === "error" ? (
        <div className="management-activity__state management-activity__state--error" role="alert">
          <span>管理活动暂时无法加载。</span>
          <button type="button" onClick={retry}>重试</button>
        </div>
      ) : activity ? (
        <>
          <div className="management-activity__summary" role="group" aria-label="管理活动摘要">
            <article><span>{scope === "admin" && !selectedSchoolId ? "成功操作（含平台）" : "成功操作"}</span><strong>{activity.summary.operation_count.toLocaleString()}</strong></article>
            <article><span>活跃账号</span><strong>{activity.summary.active_accounts.toLocaleString()}</strong></article>
            <article><span>活跃学校</span><strong>{activity.summary.active_schools.toLocaleString()}</strong></article>
          </div>

          {activity.summary.operation_count === 0 ? (
            <p className="management-activity__empty" role="status">暂无操作记录</p>
          ) : null}

          <div className="management-activity__heatmap-heading">
            <h3>各校操作热力图</h3>
            <div className="management-activity__legend" role="group" aria-label="热力图图例">
              <span>无</span>
              {[0, 1, 2, 3, 4].map((level) => (
                <span key={level} className={`management-activity__legend-swatch management-activity__cell--${level}`} aria-hidden="true" />
              ))}
              <span>多</span>
            </div>
          </div>
          <Heatmap activity={activity} page={schoolPage} onPageChange={setSchoolPage} />
          {activity.coverage.started_at ? <p className="management-activity__coverage">记录自 {new Date(activity.coverage.started_at).toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" })}</p> : null}
        </>
      ) : null}
    </section>
  );
}

export default ActivityPanel;
