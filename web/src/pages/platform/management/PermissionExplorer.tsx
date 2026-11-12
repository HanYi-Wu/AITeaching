import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlatformUser } from "../../../platform/authTypes";
import type { ManagementScope } from "../../../platform/managementApi";
import { canManage } from "../../../platform/managementAccess";
import { loadSessionToken } from "../../../platform/session";
import {
  getManagementPermissionGraph,
  type ManagementPermissionGraph,
} from "../../../platform/managementGraphApi";
import {
  effectiveRoleAssignments,
  implicationSources,
  isActivePermissionRecord,
  navigationGroupsForMenus,
  permissionForMenu,
  permissionGrantState,
  permissionSourcesForUser,
  roleMenuGrantState,
  rolesForMenu,
  usersForMenu,
  usersForRole,
  type PermissionExplorerTarget,
} from "./permissionGraphModel";
import {
  cancelFrame,
  isSpringSettled,
  prefersReducedMotion,
  requestFrame,
  springOf,
  stepSpring,
  type Spring,
} from "./permissionStage/stageMotion";
import {
  catColor,
  paintDial,
  paintOrb,
  paintOrbitGuides,
  paintThread,
  readStagePalette,
  type Curve,
  type StagePalette,
} from "./permissionStage/stagePaint";
import {
  buildScene,
  computeCoverageStats,
  grantStateLabel,
  roleCanManageMenu,
  roleKindLabel,
  userCanManageMenu,
  type Cat,
  type StageLayer,
  type StageLink,
  type StageNode,
} from "./permissionStage/stageScene";
import "./PermissionExplorer.css";

type PermissionExplorerProps = {
  user: PlatformUser;
  scope: ManagementScope;
  schoolId?: string;
  view?: "trace" | "matrix";
  onViewChange?: (view: "trace" | "matrix") => void;
  revision?: number;
  target?: PermissionExplorerTarget | null;
  onNavigateSection?: (section: string) => void;
  onOpenListView?: () => void;
  onEditUserAccess?: (userId: string, username?: string) => void;
  onEditRole?: (roleId?: string) => void;
};

type SelectedTarget = {
  cat: Cat;
  id: string;
};

type AnimNodeState = {
  x: Spring;
  y: Spring;
  s: Spring;
  a: Spring;
  born: number;
  delay: number;
};

type GhostNode = {
  node: StageNode;
  x: Spring;
  y: Spring;
  s: Spring;
  a: Spring;
  toX: number;
  toY: number;
};

type PermissionGraphSnapshot = {
  identity: string;
  graph: ManagementPermissionGraph;
};

const CAT_NAMES: Record<Cat, string> = {
  user: "用户",
  role: "角色",
  menu: "页面 / 操作",
  permission: "操作权限",
};

const ADMIN_NAVIGABLE_SECTIONS = new Set([
  "schools",
  "ai",
  "extensions",
  "audit",
  "access",
  "settings",
  "activity",
]);

export function PermissionExplorer({
  user,
  scope,
  schoolId,
  view,
  onViewChange,
  revision = 0,
  target = null,
  onNavigateSection,
  onOpenListView,
  onEditUserAccess,
  onEditRole,
}: PermissionExplorerProps) {
  const sessionToken = loadSessionToken();
  const scopeIdentityKey = JSON.stringify([
    scope,
    schoolId ?? "",
    user.id,
    user.role,
    user.status ?? "",
    user.school_id ?? "",
    user.school_access_mode ?? "",
    [...(user.management_permissions ?? [])].sort(),
    sessionToken ?? "",
  ]);
  const targetIdentityKey = target
    ? JSON.stringify([scopeIdentityKey, target.kind, target.id])
    : "";
  const currentScopeIdentityRef = useRef(scopeIdentityKey);
  currentScopeIdentityRef.current = scopeIdentityKey;
  const currentTargetIdentityRef = useRef(targetIdentityKey);
  currentTargetIdentityRef.current = targetIdentityKey;
  const [internalView, setInternalView] = useState<"trace" | "matrix">(view ?? "trace");
  const [graphSnapshot, setGraphSnapshot] = useState<PermissionGraphSnapshot | null>(null);
  const graph = graphSnapshot?.identity === scopeIdentityKey ? graphSnapshot.graph : null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [locatedUserBanner, setLocatedUserBanner] = useState("");

  // 3-layer stage state: hub (全景) -> module (分类列表) -> entity (实体链路)
  const [layer, setLayer] = useState<StageLayer>("hub");
  const [moduleCat, setModuleCat] = useState<"user" | "role" | "menu" | null>(null);
  const [modulePage, setModulePage] = useState(1);
  const [selected, setSelected] = useState<SelectedTarget | null>(null);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState<{ w: number; h: number }>({ w: 1040, h: 580 });
  const [ghosts, setGhosts] = useState<GhostNode[]>([]);

  const locatedTargetKeyRef = useRef("");
  const activeTargetIdentityRef = useRef(targetIdentityKey);
  const requestIdentityRef = useRef(scopeIdentityKey);
  const locateRequestRef = useRef(0);
  const activeView = view ?? internalView;

  const rootRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodeElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const ghostElsRef = useRef<Map<string, HTMLElement>>(new Map());
  const animStatesRef = useRef<Map<string, AnimNodeState>>(new Map());
  const ghostsRef = useRef<GhostNode[]>([]);
  const prevNodesRef = useRef<Map<string, StageNode>>(new Map());
  const paletteRef = useRef<StagePalette | null>(null);
  const rafRef = useRef<number>(0);
  const wakeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (view) setInternalView(view);
  }, [view]);

  const setActiveView = useCallback(
    (next: "trace" | "matrix") => {
      setInternalView(next);
      onViewChange?.(next);
    },
    [onViewChange],
  );

  const canJumpToMenu = useCallback(
    (candidate?: ManagementPermissionGraph["menus"][number]) => {
      if (!candidate?.section || !onNavigateSection || candidate.section === "access") return false;
      const menu = graph?.menus.find((item) => item.id === candidate.id);
      if (!menu || !canManage(user, permissionForMenu(menu))) return false;
      if (scope === "school") return true;
      return ADMIN_NAVIGABLE_SECTIONS.has(menu.section);
    },
    [graph, onNavigateSection, scope, user],
  );

  useEffect(() => {
    setGraphSnapshot(null);
    setError("");
    setSearchInput("");
    setSearch("");
    setUserPage(1);
    setLocatedUserBanner("");
    setLayer("hub");
    setModuleCat(null);
    setModulePage(1);
    setSelected(null);
    locatedTargetKeyRef.current = "";
    locateRequestRef.current += 1;
  }, [scopeIdentityKey]);

  useEffect(() => {
    if (scope === "admin" && !schoolId) {
      setGraphSnapshot(null);
      setLoading(false);
      setError("");
      return;
    }
    if (requestIdentityRef.current !== scopeIdentityKey) {
      requestIdentityRef.current = scopeIdentityKey;
      if (userPage !== 1 || search !== "") {
        return;
      }
    }
    let cancelled = false;
    const requestedIdentity = scopeIdentityKey;
    const requestedToken = sessionToken;
    const isCurrentRequest = () =>
      !cancelled &&
      currentScopeIdentityRef.current === requestedIdentity &&
      loadSessionToken() === requestedToken;
    setLoading(true);
    setError("");
    void getManagementPermissionGraph(scope, {
      schoolId,
      q: search || undefined,
      page: userPage,
      pageSize: 50,
    })
      .then((data) => {
        if (isCurrentRequest()) setGraphSnapshot({ identity: requestedIdentity, graph: data });
      })
      .catch((err) => {
        if (isCurrentRequest()) setError(err instanceof Error ? err.message : "加载权限关系失败");
      })
      .finally(() => {
        if (isCurrentRequest()) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [revision, schoolId, scope, scopeIdentityKey, search, userPage, sessionToken]);

  // Apply deep-linked target
  useEffect(() => {
    if (activeTargetIdentityRef.current !== targetIdentityKey) {
      activeTargetIdentityRef.current = targetIdentityKey;
      locatedTargetKeyRef.current = "";
      locateRequestRef.current += 1;
      setLocatedUserBanner("");
    }
    if (!graph || !target) return;
    if (target.kind === "user") {
      const matched = graph.users.find(
        (item) => item.id === target.id || item.username === target.id,
      );
      if (matched) {
        setModuleCat("user");
        setSelected({ cat: "user", id: matched.id });
        setLayer("entity");
        return;
      }
      const locateKey = targetIdentityKey;
      if (locatedTargetKeyRef.current === locateKey) return;
      locatedTargetKeyRef.current = locateKey;
      const requestedIdentity = scopeIdentityKey;
      const requestedToken = sessionToken;
      const requestId = ++locateRequestRef.current;
      const isCurrentLookup = () =>
        currentScopeIdentityRef.current === requestedIdentity &&
        currentTargetIdentityRef.current === locateKey &&
        locateRequestRef.current === requestId &&
        loadSessionToken() === requestedToken;
      void getManagementPermissionGraph(scope, {
        schoolId,
        q: target.id,
        page: 1,
        pageSize: 50,
      })
        .then((located) => {
          if (!isCurrentLookup()) return;
          const locatedUser = located.users.find(
            (item) => item.id === target.id || item.username === target.id,
          );
          if (!locatedUser) {
            setError("未能定位助手指向的账号，请确认账号和学校范围。");
            return;
          }
          setSearchInput(target.id);
          setSearch(target.id);
          setUserPage(1);
          setGraphSnapshot({ identity: requestedIdentity, graph: located });
          setModuleCat("user");
          setSelected({ cat: "user", id: locatedUser.id });
          setLayer("entity");
          setLocatedUserBanner(`已定位账号：${locatedUser.display_name || locatedUser.username}`);
        })
        .catch(() => {
          if (isCurrentLookup()) setError("定位助手指向的账号失败，请检查连接后重试。");
        });
      return;
    }

    if (target.kind === "role" && graph.roles.some((item) => item.id === target.id)) {
      setModuleCat("role");
      setSelected({ cat: "role", id: target.id });
      setLayer("entity");
    } else if (target.kind === "menu") {
      const matchedMenu = graph.menus.find(
        (item) => item.id === target.id || item.section === target.id,
      );
      if (matchedMenu) {
        setModuleCat("menu");
        setSelected({ cat: "menu", id: matchedMenu.id });
        setLayer("entity");
      }
    } else if (target.kind === "permission" && graph.catalog.some((item) => item.key === target.id)) {
      setModuleCat("menu");
      setSelected({ cat: "permission", id: target.id });
      setLayer("entity");
    }
  }, [graph, schoolId, scope, scopeIdentityKey, target, targetIdentityKey, sessionToken]);

  // Observe stage size and theme changes
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const syncPalette = () => {
      paletteRef.current = readStagePalette(root);
      wakeRef.current();
    };
    syncPalette();

    const updateSize = () => {
      const rect = root.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 120) {
        const nextW = Math.round(rect.width);
        const nextH = Math.round(rect.height);
        setStageSize((prev) =>
          prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH },
        );
      }
    };
    updateSize();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => updateSize());
      ro.observe(root);
    }

    let mo: MutationObserver | null = null;
    if (typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => syncPalette());
      mo.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-eh-theme", "data-or-theme", "data-or-accent", "class"],
      });
    }

    return () => {
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [activeView, Boolean(graph)]);

  const stats = useMemo(() => (graph ? computeCoverageStats(graph) : null), [graph]);

  const builtScene = useMemo(
    () =>
      graph
        ? buildScene(
            graph,
            { layer, moduleCat, selected, modulePage },
            stageSize.w,
            stageSize.h,
          )
        : { nodes: [], links: [] },
    [graph, layer, moduleCat, modulePage, selected, stageSize.h, stageSize.w],
  );

  const sceneNodes = builtScene.nodes;
  const sceneLinks = builtScene.links;
  const modulePagination = builtScene.modulePagination;

  const nodeById = useMemo(
    () => new Map(sceneNodes.map((node) => [node.id, node])),
    [sceneNodes],
  );

  // Synchronize spring states and create exit ghosts when sceneNodes change
  useEffect(() => {
    const now = typeof performance !== "undefined" ? performance.now() : 0;
    const nextIds = new Set(sceneNodes.map((node) => node.id));
    const currentPos = (id?: string) => {
      if (!id) return null;
      const st = animStatesRef.current.get(id);
      if (st) return { x: st.x.v, y: st.y.v };
      const existing = nodeById.get(id) ?? prevNodesRef.current.get(id);
      return existing ? { x: existing.x, y: existing.y } : null;
    };

    const newGhosts: GhostNode[] = [];
    if (!prefersReducedMotion()) {
      prevNodesRef.current.forEach((oldNode, id) => {
        if (nextIds.has(id)) return;
        const st = animStatesRef.current.get(id);
        if (!st || st.a.v < 0.15) {
          animStatesRef.current.delete(id);
          return;
        }
        const back = currentPos(oldNode.from) ?? { x: st.x.v, y: st.y.v };
        newGhosts.push({
          node: oldNode,
          x: springOf(st.x.v),
          y: springOf(st.y.v),
          s: springOf(st.s.v),
          a: springOf(st.a.v),
          toX: back.x,
          toY: back.y,
        });
        animStatesRef.current.delete(id);
      });
    } else {
      Array.from(animStatesRef.current.keys()).forEach((id) => {
        if (!nextIds.has(id)) animStatesRef.current.delete(id);
      });
    }

    sceneNodes.forEach((node) => {
      if (animStatesRef.current.has(node.id)) return;
      const origin = currentPos(node.from);
      if (origin && !prefersReducedMotion()) {
        animStatesRef.current.set(node.id, {
          x: springOf(origin.x),
          y: springOf(origin.y),
          s: springOf(0.45),
          a: springOf(0),
          born: now,
          delay: node.delay ?? 0,
        });
      } else {
        animStatesRef.current.set(node.id, {
          x: springOf(node.x),
          y: springOf(node.y),
          s: springOf(1),
          a: springOf(1),
          born: now,
          delay: 0,
        });
      }
    });

    prevNodesRef.current = new Map(sceneNodes.map((node) => [node.id, node]));
    if (newGhosts.length > 0) {
      ghostsRef.current = [...ghostsRef.current.slice(-10), ...newGhosts];
      setGhosts([...ghostsRef.current]);
    }
    wakeRef.current();
  }, [nodeById, sceneNodes]);

  // Neighbor map for hover spotlighting (in hub layer, also highlights cross-category ownership!)
  const neighborsMap = useMemo(() => {
    const map = new Map<string, Set<string>>();
    sceneNodes.forEach((node) => map.set(node.id, new Set([node.id])));
    sceneLinks.forEach((link) => {
      map.get(link.a)?.add(link.b);
      map.get(link.b)?.add(link.a);
    });

    if (graph && layer === "hub") {
      const addPair = (a: string, b: string) => {
        map.get(a)?.add(b);
        map.get(b)?.add(a);
      };
      graph.roles.forEach((role) => {
        const rId = `role:${role.id}`;
        usersForRole(graph, role.id).forEach((u) => {
          addPair(rId, `user:${u.id}`);
          addPair(rId, "hub:user");
          addPair(`user:${u.id}`, "hub:role");
        });
        graph.menus.forEach((m) => {
          const st = roleMenuGrantState(role, m);
          if (st !== "none" && st !== "inactive") {
            addPair(rId, `menu:${m.id}`);
            addPair(rId, "hub:menu");
            addPair(`menu:${m.id}`, "hub:role");
          }
        });
      });
      graph.menus.forEach((m) => {
        const mId = `menu:${m.id}`;
        usersForMenu(graph, m).forEach((u) => {
          addPair(mId, `user:${u.id}`);
          addPair(mId, "hub:user");
          addPair(`user:${u.id}`, "hub:menu");
        });
      });
    }

    return map;
  }, [graph, layer, sceneLinks, sceneNodes]);

  const activeNodeId = useMemo(
    () => sceneNodes.find((node) => node.active)?.id ?? null,
    [sceneNodes],
  );

  const focusNodeId = hoveredId ?? activeNodeId;

  const isNodeDim = useCallback(
    (node: StageNode) => {
      if (!hoveredId) return false;
      return !neighborsMap.get(hoveredId)?.has(node.id);
    },
    [hoveredId, neighborsMap],
  );

  const isLinkLit = useCallback(
    (link: StageLink) => {
      if (hoveredId) {
        const related = neighborsMap.get(hoveredId);
        return (
          link.a === hoveredId ||
          link.b === hoveredId ||
          Boolean(related?.has(link.a) && related?.has(link.b))
        );
      }
      return Boolean(link.active);
    },
    [hoveredId, neighborsMap],
  );

  const frameContextRef = useRef({
    sceneNodes,
    sceneLinks,
    nodeById,
    layer,
    hoveredId,
    focusNodeId,
    isLinkLit,
    stageSize,
  });
  frameContextRef.current = {
    sceneNodes,
    sceneLinks,
    nodeById,
    layer,
    hoveredId,
    focusNodeId,
    isLinkLit,
    stageSize,
  };

  // Wake animation loop on hover or size changes
  useEffect(() => {
    wakeRef.current();
  }, [hoveredId, stageSize.w, stageSize.h, layer]);

  // Demand-driven Spring + Canvas render engine (automatically sleeps at 0% CPU when springs settle)
  useEffect(() => {
    if (activeView !== "trace" || !graph) return;

    let lastTime = typeof performance !== "undefined" ? performance.now() : 0;

    const tick = (now: number) => {
      rafRef.current = 0;
      const ctxState = frameContextRef.current;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      let anyMoving = false;

      // 1. Step foreground node springs & update DOM transforms directly
      ctxState.sceneNodes.forEach((node) => {
        const st = animStatesRef.current.get(node.id);
        if (!st) return;
        const ready = (now - st.born) / 1000 >= st.delay;
        if (!ready) {
          anyMoving = true;
        } else {
          stepSpring(st.x, node.x, dt, 92);
          stepSpring(st.y, node.y, dt, 92);
          stepSpring(st.s, 1, dt, 105);
          stepSpring(st.a, 1, dt, 125);
          if (
            !isSpringSettled(st.x, node.x) ||
            !isSpringSettled(st.y, node.y) ||
            !isSpringSettled(st.s, 1, 0.01) ||
            !isSpringSettled(st.a, 1, 0.01)
          ) {
            anyMoving = true;
          }
        }
        const el = nodeElsRef.current.get(node.id);
        if (el) {
          const sc = Math.max(0.01, st.s.v);
          const op = Math.max(0, Math.min(1, st.a.v));
          el.style.transform = `translate3d(${st.x.v}px, ${st.y.v}px, 0) scale(${sc})`;
          el.style.opacity = String(op);
        }
      });

      // 2. Step ghost exit springs
      let ghostsChanged = false;
      ghostsRef.current.forEach((ghost) => {
        anyMoving = true;
        stepSpring(ghost.x, ghost.toX, dt, 105);
        stepSpring(ghost.y, ghost.toY, dt, 105);
        stepSpring(ghost.s, 0.35, dt, 115);
        stepSpring(ghost.a, 0, dt, 115);
        const el = ghostElsRef.current.get(ghost.node.id);
        if (el) {
          el.style.transform = `translate3d(${ghost.x.v}px, ${ghost.y.v}px, 0) scale(${Math.max(0.01, ghost.s.v)})`;
          el.style.opacity = String(Math.max(0, Math.min(1, ghost.a.v)));
        }
      });
      if (ghostsRef.current.some((ghost) => ghost.a.v < 0.03)) {
        ghostsRef.current = ghostsRef.current.filter((ghost) => ghost.a.v >= 0.03);
        ghostsChanged = true;
      }
      if (ghostsChanged) {
        setGhosts([...ghostsRef.current]);
      }

      // 3. Paint Canvas layer
      const canvas = canvasRef.current;
      const root = rootRef.current;
      if (canvas && root) {
        if (!paletteRef.current) {
          paletteRef.current = readStagePalette(root);
        }
        const palette = paletteRef.current;
        const W = ctxState.stageSize.w;
        const H = ctxState.stageSize.h;
        const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
        const targetW = Math.round(W * dpr);
        const targetH = Math.round(H * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }
        let ctx: CanvasRenderingContext2D | null = null;
        if (typeof navigator === "undefined" || !/jsdom/i.test(navigator.userAgent)) {
          try {
            ctx = canvas.getContext("2d");
          } catch {
            ctx = null;
          }
        }
        if (ctx) {
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.clearRect(0, 0, W, H);

          if (ctxState.layer === "hub") {
            const coreNode = ctxState.nodeById.get("core");
            const coreSt = animStatesRef.current.get("core");
            if (coreNode && coreSt) {
              const orbitR = Math.min(W * 0.2, H * 0.25, 148);
              paintOrbitGuides(ctx, coreSt.x.v, coreSt.y.v, orbitR, palette, coreSt.a.v);
            }
          }

          const curveFor = (link: StageLink): Curve | null => {
            const A = ctxState.nodeById.get(link.a);
            const B = ctxState.nodeById.get(link.b);
            const sa = animStatesRef.current.get(link.a);
            const sb = animStatesRef.current.get(link.b);
            if (!A || !B || !sa || !sb) return null;
            const ax = sa.x.v;
            const ay = sa.y.v;
            const bx = sb.x.v;
            const by = sb.y.v;
            const dx = bx - ax;
            const dy = by - ay;
            const dist = Math.hypot(dx, dy) || 1;
            const ux = dx / dist;
            const uy = dy / dist;
            const r1 = A.kind === "item" ? 10 : (A.size / 2) * sa.s.v + 4;
            const r2 = B.kind === "item" ? 10 : (B.size / 2) * sb.s.v + 4;

            if (link.shape === "h") {
              const dir = dx >= 0 ? 1 : -1;
              const x1 = ax + dir * r1;
              const y1 = ay;
              const x2 = bx - dir * r2;
              const y2 = by;
              const span = (x2 - x1) * 0.48;
              return { x1, y1, c1x: x1 + span, c1y: y1, c2x: x2 - span, c2y: y2, x2, y2 };
            }

            const x1 = ax + ux * r1;
            const y1 = ay + uy * r1;
            const x2 = bx - ux * r2;
            // 若目标圆盘位于正上方，避开圆盘下方的「角色」文字标签
            const y2 =
              B.kind === "hub" && dy < -50 && Math.abs(dx) < 30
                ? by + r2 + 28
                : by - uy * r2;

            const nx = -uy;
            const ny = ux;
            const bend = Math.abs(dx) < 25 ? 0 : dist * 0.05;
            return {
              x1,
              y1,
              c1x: x1 + dx * 0.34 + nx * bend,
              c1y: y1 + (y2 - y1) * 0.34 + ny * bend,
              c2x: x1 + dx * 0.66 + nx * bend * 0.5,
              c2y: y1 + (y2 - y1) * 0.66 + ny * bend * 0.5,
              x2,
              y2,
            };
          };

          ctxState.sceneLinks.forEach((link) => {
            const g = curveFor(link);
            if (!g) return;
            const sa = animStatesRef.current.get(link.a);
            const sb = animStatesRef.current.get(link.b);
            const nodeAlpha = Math.min(sa?.a.v ?? 1, sb?.a.v ?? 1);
            const lit = ctxState.isLinkLit(link);
            const colorA = lit ? palette.accent : palette.ink;
            const colorB = lit ? palette.accent : palette.ink;
            const baseAlpha = lit ? (ctxState.hoveredId ? 0.85 : 0.42) : 0.14;
            paintThread(
              ctx,
              g,
              colorA,
              colorB,
              baseAlpha * nodeAlpha,
              lit ? 1.75 : 1.1,
              link.dashed,
              lit,
            );
          });

          // 绘制中心球与三枚分类圆盘
          ctxState.sceneNodes.forEach((node) => {
            const st = animStatesRef.current.get(node.id);
            if (!st) return;
            const dimmed = ctxState.hoveredId
              ? !neighborsMap.get(ctxState.hoveredId)?.has(node.id)
              : false;
            const alpha = st.a.v * (dimmed ? 0.55 : 1);
            if (node.kind === "core") {
              paintOrb(
                ctx,
                st.x.v,
                st.y.v,
                (node.size / 2) * st.s.v,
                palette,
                alpha,
                ctxState.hoveredId === node.id,
              );
            } else if (node.kind === "hub") {
              paintDial(
                ctx,
                st.x.v,
                st.y.v,
                node.size * st.s.v,
                catColor(palette, node.cat, node.tone),
                palette,
                {
                  alpha,
                  ratio: node.ratio,
                  active: ctxState.focusNodeId === node.id || Boolean(node.active),
                },
              );
            }
          });
        }
      }

      if (anyMoving) {
        rafRef.current = requestFrame(tick);
      }
    };

    const wake = () => {
      if (!rafRef.current) {
        lastTime = typeof performance !== "undefined" ? performance.now() : 0;
        rafRef.current = requestFrame(tick);
      }
    };
    wakeRef.current = wake;
    wake();

    return () => {
      if (rafRef.current) {
        cancelFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [activeView, graph, neighborsMap]);

  const toOverview = useCallback(() => {
    setLayer("hub");
    setModuleCat(null);
    setModulePage(1);
    setSelected(null);
    setHoveredId(null);
  }, []);

  const toModule = useCallback((cat: "user" | "role" | "menu") => {
    setModuleCat(cat);
    setModulePage(1);
    setSelected(null);
    setLayer("module");
    setHoveredId(null);
  }, []);

  const toEntity = useCallback((cat: Cat, id: string) => {
    if (cat === "user" || cat === "role" || cat === "menu") {
      setModuleCat(cat);
    }
    setSelected({ cat, id });
    setLayer("entity");
    setHoveredId(null);
  }, []);

  const stepBack = useCallback(() => {
    if (layer === "entity") {
      if (moduleCat) {
        setSelected(null);
        setLayer("module");
      } else {
        toOverview();
      }
    } else if (layer === "module") {
      toOverview();
    }
  }, [layer, moduleCat, toOverview]);

  const handleNodeClick = useCallback(
    (node: StageNode) => {
      if (node.clickable === false) return;
      if (node.id === "core") {
        toOverview();
        return;
      }
      if (node.expandModule) {
        toModule(node.expandModule);
        return;
      }
      if (node.kind === "hub" && node.cat && node.cat !== "permission") {
        toModule(node.cat);
        return;
      }
      if (node.cat && node.rawId) {
        toEntity(node.cat, node.rawId);
      }
    },
    [toEntity, toModule, toOverview],
  );

  // 右侧详情与可执行操作面板数据（明确归属关系 + 点击直达对应页面或配置界面）
  const entityInsight = useMemo(() => {
    if (!graph || layer !== "entity" || !selected) return null;

    type ActionBtn = {
      label: string;
      primary?: boolean;
      onClick: () => void;
    };

    type GroupItem = {
      id: string;
      name: string;
      sub?: string;
      badge?: string;
      badgeTone?: "manage" | "read";
      jumpSection?: string;
      jumpLabel?: string;
      editUserId?: string;
      editUsername?: string;
    };

    if (selected.cat === "user") {
      const u = graph.users.find((item) => item.id === selected.id);
      if (!u) return null;
      const roles = effectiveRoleAssignments(graph, u).map((item) => item.role);
      const reachableMenus = graph.menus.filter((menu) =>
        roles.some((role) => {
          const st = roleMenuGrantState(role, menu);
          return st !== "none" && st !== "inactive";
        }),
      );
      const active = isActivePermissionRecord(u);

      const actions: ActionBtn[] = [];
      if (onEditUserAccess) {
        actions.push({
          label: "修改该账号权限 →",
          primary: true,
          onClick: () => onEditUserAccess(u.id, u.username),
        });
      } else if (onOpenListView) {
        actions.push({
          label: "在权限列表中查看 →",
          primary: true,
          onClick: () => onOpenListView(),
        });
      }
      actions.push({
        label: "切换到权限矩阵",
        onClick: () => setActiveView("matrix"),
      });

      return {
        cat: "user" as Cat,
        tag: active ? "管理账号" : "管理账号 · 已停用",
        title: u.display_name || u.username,
        sub: `登录账号：${u.username}`,
        actions,
        groups: [
          {
            label: `绑定的权限角色（${roles.length}）`,
            cat: "role" as Cat,
            items: roles.map(
              (r): GroupItem => ({
                id: r.id,
                name: r.name,
                badge: roleKindLabel(r),
              }),
            ),
          },
          {
            label: `归该账号管辖 / 可访问的页面（${reachableMenus.length}）`,
            cat: "menu" as Cat,
            items: reachableMenus.map((m): GroupItem => {
              const canManage = userCanManageMenu(graph, u, m);
              const jumpable = canJumpToMenu(m);
              return {
                id: m.id,
                name: m.label,
                badge: canManage ? "可管理" : "仅查看",
                badgeTone: canManage ? "manage" : "read",
                jumpSection: jumpable ? m.section : undefined,
                jumpLabel: jumpable ? `前往${m.label}` : undefined,
              };
            }),
          },
        ],
      };
    }

    if (selected.cat === "role") {
      const r = graph.roles.find((item) => item.id === selected.id);
      if (!r) return null;
      const holders = usersForRole(graph, r.id);
      const grantedMenus = graph.menus.filter((menu) => {
        const st = roleMenuGrantState(r, menu);
        return st !== "none" && st !== "inactive";
      });
      const active = isActivePermissionRecord(r);

      const actions: ActionBtn[] = [];
      if (!r.builtin && r.kind === "custom" && onEditRole) {
        actions.push({
          label: "编辑该角色权限",
          primary: true,
          onClick: () => onEditRole(r.id),
        });
      }
      if (onOpenListView) {
        actions.push({
          label: "去分配账号角色 →",
          primary: actions.length === 0,
          onClick: () => onOpenListView(),
        });
      }
      actions.push({
        label: "在矩阵中对比",
        onClick: () => setActiveView("matrix"),
      });

      return {
        cat: "role" as Cat,
        tag: active ? roleKindLabel(r) : `${roleKindLabel(r)} · 已停用`,
        title: r.name,
        sub: undefined,
        actions,
        groups: [
          {
            label: `持有该角色的账号（${holders.length}）`,
            cat: "user" as Cat,
            items: holders.map(
              (u): GroupItem => ({
                id: u.id,
                name: u.display_name || u.username,
                badge: u.username,
                editUserId: onEditUserAccess ? u.id : undefined,
                editUsername: onEditUserAccess ? u.username : undefined,
              }),
            ),
          },
          {
            label: `归该角色管辖的页面（${grantedMenus.length}）`,
            cat: "menu" as Cat,
            items: grantedMenus.map((m): GroupItem => {
              const st = roleMenuGrantState(r, m);
              const sources =
                st === "implied"
                  ? implicationSources(graph, r, permissionForMenu(m)).map(
                      (key) => graph.catalog.find((item) => item.key === key)?.label ?? key,
                    )
                  : [];
              const canManage = roleCanManageMenu(graph, r, m);
              const jumpable = canJumpToMenu(m);
              return {
                id: m.id,
                name: m.label,
                sub:
                  st === "implied" && sources.length
                    ? `由「${sources.join("、")}」包含`
                    : undefined,
                badge: canManage ? "可管理" : "仅查看",
                badgeTone: canManage ? "manage" : "read",
                jumpSection: jumpable ? m.section : undefined,
                jumpLabel: jumpable ? `前往${m.label}` : undefined,
              };
            }),
          },
        ],
      };
    }

    if (selected.cat === "menu") {
      const m = graph.menus.find((item) => item.id === selected.id);
      if (!m) return null;
      const roles = rolesForMenu(graph, m);
      const users = usersForMenu(graph, m);
      const jumpable = canJumpToMenu(m);

      const actions: ActionBtn[] = [];
      if (jumpable && onNavigateSection) {
        actions.push({
          label: `前往「${m.label}」页面 →`,
          primary: true,
          onClick: () => onNavigateSection(m.section),
        });
      }
      if (onOpenListView) {
        actions.push({
          label: "去配置该功能权限",
          primary: actions.length === 0,
          onClick: () => onOpenListView(),
        });
      }
      actions.push({
        label: "在矩阵中对比",
        onClick: () => setActiveView("matrix"),
      });

      return {
        cat: "menu" as Cat,
        tag: "页面功能归属",
        title: m.label,
        sub: undefined,
        actions,
        groups: [
          {
            label: `归谁管辖 / 可访问的账号（${users.length}）`,
            cat: "user" as Cat,
            items: users.map((u): GroupItem => {
              const canManage = userCanManageMenu(graph, u, m);
              return {
                id: u.id,
                name: u.display_name || u.username,
                sub: u.username,
                badge: canManage ? "可管理" : "仅查看",
                badgeTone: canManage ? "manage" : "read",
                editUserId: onEditUserAccess ? u.id : undefined,
                editUsername: onEditUserAccess ? u.username : undefined,
              };
            }),
          },
          {
            label: `包含该页面的角色（${roles.length}）`,
            cat: "role" as Cat,
            items: roles.map((r): GroupItem => {
              const canManage = roleCanManageMenu(graph, r, m);
              return {
                id: r.id,
                name: r.name,
                badge: canManage ? "可管理" : "仅查看",
                badgeTone: canManage ? "manage" : "read",
              };
            }),
          },
        ],
      };
    }

    const perm = graph.catalog.find((item) => item.key === selected.id);
    if (!perm) return null;
    const roles = graph.roles.filter((role) => {
      const st = permissionGrantState(role, perm.key);
      return st !== "none" && st !== "inactive";
    });
    const users = graph.users.filter(
      (u) => permissionSourcesForUser(graph, u, perm.key).length > 0,
    );

    const actions: ActionBtn[] = [];
    if (onOpenListView) {
      actions.push({
        label: "去配置权限分配 →",
        primary: true,
        onClick: () => onOpenListView(),
      });
    }

    return {
      cat: "permission" as Cat,
      tag: "操作权限归属",
      title: perm.label,
      sub: perm.description || undefined,
      actions,
      groups: [
        {
          label: `可执行该操作的账号（${users.length}）`,
          cat: "user" as Cat,
          items: users.map(
            (u): GroupItem => ({
              id: u.id,
              name: u.display_name || u.username,
              badge: u.username,
              editUserId: onEditUserAccess ? u.id : undefined,
              editUsername: onEditUserAccess ? u.username : undefined,
            }),
          ),
        },
        {
          label: `包含该权限的角色（${roles.length}）`,
          cat: "role" as Cat,
          items: roles.map(
            (r): GroupItem => ({
              id: r.id,
              name: r.name,
              badge: roleKindLabel(r),
            }),
          ),
        },
      ],
    };
  }, [
    canJumpToMenu,
    graph,
    layer,
    onEditRole,
    onEditUserAccess,
    onNavigateSection,
    onOpenListView,
    selected,
    setActiveView,
  ]);

  const menuGroups = useMemo(
    () => navigationGroupsForMenus(graph?.menus ?? []),
    [graph?.menus],
  );

  if (scope === "admin" && !schoolId) {
    return (
      <section className="mgmt-empty-block" aria-live="polite">
        <h4>选择学校后查看权限关系</h4>
        <p>请先在顶部学校切换器中选择目标学校。</p>
      </section>
    );
  }

  return (
    <section className="permission-explorer" aria-label="权限星图与矩阵">
      {error && (
        <div className="mgmt-callout mgmt-callout--danger" role="alert">
          {error}
        </div>
      )}

      {locatedUserBanner && (
        <div className="mgmt-callout mgmt-callout--accent" role="status">
          <span>{locatedUserBanner}</span>
          {search && (
            <button
              type="button"
              className="mgmt-btn mgmt-btn--ghost"
              onClick={() => {
                setSearchInput("");
                setSearch("");
                setLocatedUserBanner("");
              }}
            >
              返回全部账号
            </button>
          )}
        </div>
      )}

      {loading || !graph ? (
        <div className="mgmt-empty-block" aria-live="polite">
          <h4>{error ? "权限关系暂不可用" : "正在加载权限星图..."}</h4>
        </div>
      ) : !stats ? null : activeView === "trace" ? (
        <div
          ref={rootRef}
          className={`pst is-${layer}${entityInsight ? " has-insight" : ""}`}
          tabIndex={0}
          aria-label="权限全景交互星图"
          onClick={(event) => {
            if (event.target === event.currentTarget && layer !== "hub") {
              stepBack();
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape" && layer !== "hub") {
              event.preventDefault();
              stepBack();
            }
          }}
        >
          {/* ── 底层 Canvas：中心球、表盘刻度、平滑贝塞尔连接线 ── */}
          <canvas ref={canvasRef} className="pst-canvas" aria-hidden="true" />

          {/* ── 前景 DOM 交互层（所有文字清晰可读、所有节点均可点击） ── */}
          <div className="pst-layer">
            {sceneNodes.map((node) => {
              const dimmed = isNodeDim(node);
              const isFocused = focusNodeId === node.id || Boolean(node.active);
              const Tag = node.clickable === false ? "div" : "button";
              return (
                <Tag
                  key={node.id}
                  ref={(el: HTMLElement | null) => {
                    if (el) nodeElsRef.current.set(node.id, el);
                    else nodeElsRef.current.delete(node.id);
                  }}
                  type={node.clickable === false ? undefined : "button"}
                  className={[
                    "pst-node",
                    `is-${node.kind}`,
                    node.cat ? `cat-${node.cat}` : "",
                    node.tone ? `tone-${node.tone}` : "",
                    node.align ? `align-${node.align}` : "",
                    isFocused ? "is-active" : "",
                    dimmed ? "is-dim" : "",
                    node.clickable === false ? "is-static" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={{
                    transform: `translate3d(${node.x}px, ${node.y}px, 0)`,
                  }}
                  aria-label={node.ariaLabel ?? node.label}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId((prev) => (prev === node.id ? null : prev))}
                  onClick={() => handleNodeClick(node)}
                >
                  {node.kind === "core" && (
                    <>
                      <span
                        className="pst-hit"
                        style={{ width: `${node.size}px`, height: `${node.size}px` }}
                      />
                      <span
                        className="pst-below"
                        style={{ top: `calc(50% + ${node.size / 2 + 14}px)` }}
                      >
                        <span className="pst-title">{node.label}</span>
                      </span>
                    </>
                  )}

                  {node.kind === "hub" && (
                    <>
                      <span
                        className="pst-dial-face"
                        style={{ width: `${node.size}px`, height: `${node.size}px` }}
                      >
                        {node.cat === "role" && (
                          <svg className="pst-dial-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M8 1.5 13 3.6v4.1c0 3.2-2.1 5.8-5 6.8-2.9-1-5-3.6-5-6.8V3.6L8 1.5Z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                            />
                            <path
                              d="m6 8 1.4 1.4L10.3 6.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                            />
                          </svg>
                        )}
                        {node.cat === "user" && (
                          <svg className="pst-dial-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <circle
                              cx="6.5"
                              cy="5.5"
                              r="2.4"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                            />
                            <path
                              d="M2.3 13c.5-2.2 2.2-3.5 4.2-3.5s3.7 1.3 4.2 3.5"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.4"
                              strokeLinecap="round"
                            />
                            <circle
                              cx="11.5"
                              cy="6.2"
                              r="1.8"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.3"
                            />
                          </svg>
                        )}
                        {node.cat === "menu" && (
                          <svg className="pst-dial-ico" viewBox="0 0 16 16" aria-hidden="true">
                            <path
                              d="M3 4.5h10M3 8h7M3 11.5h10"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              strokeLinecap="round"
                            />
                          </svg>
                        )}
                        <b className="pst-dial-num">{node.count ?? 0}</b>
                      </span>
                      <span
                        className="pst-below"
                        style={{ top: `calc(50% + ${node.size / 2 + 10}px)` }}
                      >
                        <span className="pst-title">{node.label}</span>
                      </span>
                    </>
                  )}

                  {node.kind === "item" && (
                    <span className="pst-pill">
                      <span className="pst-ring" />
                      <span className="pst-pill-txt">
                        <span className="pst-title">{node.label}</span>
                        {node.sub && <span className="pst-sub">{node.sub}</span>}
                      </span>
                      {node.badge && <span className="pst-badge">{node.badge}</span>}
                    </span>
                  )}
                </Tag>
              );
            })}

            {ghosts.map((ghost) => (
              <div
                key={`ghost:${ghost.node.id}`}
                ref={(el) => {
                  if (el) ghostElsRef.current.set(ghost.node.id, el);
                  else ghostElsRef.current.delete(ghost.node.id);
                }}
                className={[
                  "pst-node",
                  `is-${ghost.node.kind}`,
                  ghost.node.cat ? `cat-${ghost.node.cat}` : "",
                  ghost.node.align ? `align-${ghost.node.align}` : "",
                  "is-ghost",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-hidden="true"
              >
                {ghost.node.kind === "item" && (
                  <span className="pst-pill">
                    <span className="pst-ring" />
                    <span className="pst-pill-txt">
                      <span className="pst-title">{ghost.node.label}</span>
                      {ghost.node.sub && <span className="pst-sub">{ghost.node.sub}</span>}
                    </span>
                    {ghost.node.badge && <span className="pst-badge">{ghost.node.badge}</span>}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* ── 左上角层级面包屑（统一项目色阶，无花哨彩色字） ── */}
          <nav className="pst-crumbs" aria-label="星图层级导航">
            {layer !== "hub" && (
              <button
                type="button"
                className="pst-back"
                onClick={stepBack}
                title="返回上一层 (Esc)"
                aria-label="返回上一层"
              >
                <svg viewBox="0 0 14 14" aria-hidden="true">
                  <path
                    d="M8.8 3.2 5 7l3.8 3.8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`pst-crumb${layer === "hub" ? " is-current" : ""}`}
              aria-label={layer === "hub" ? "权限全景" : "返回权限全景"}
              onClick={toOverview}
            >
              <span>权限全景</span>
            </button>

            {moduleCat && (
              <>
                <span className="pst-sep">/</span>
                <button
                  type="button"
                  className={`pst-crumb${layer === "module" ? " is-current" : ""}`}
                  onClick={() => toModule(moduleCat)}
                >
                  {CAT_NAMES[moduleCat]}
                </button>
              </>
            )}

            {layer === "entity" && entityInsight && (
              <>
                <span className="pst-sep">/</span>
                <b className="pst-crumb-leaf">{entityInsight.title}</b>
              </>
            )}
          </nav>

          {/* ── 第 3 层三列标头（干净中性排版） ── */}
          {layer === "entity" && (
            <div className="pst-trace-cols" aria-hidden="true">
              <span>用户账号</span>
              <span>权限角色</span>
              <span>可访问页面</span>
            </div>
          )}

          {/* ── 右上角快速分类切换胶囊 ── */}
          {layer !== "entity" && (
            <aside className="pst-legend" aria-label="权限分类快速切换">
              <button
                type="button"
                className={`pst-legend-cell${moduleCat === "user" ? " is-active" : ""}`}
                onClick={() => toModule("user")}
              >
                <span>用户</span>
                <b>{stats.userTotal}</b>
              </button>
              <button
                type="button"
                className={`pst-legend-cell${moduleCat === "role" ? " is-active" : ""}`}
                onClick={() => toModule("role")}
              >
                <span>角色</span>
                <b>{stats.roleTotal}</b>
              </button>
              <button
                type="button"
                className={`pst-legend-cell${moduleCat === "menu" ? " is-active" : ""}`}
                onClick={() => toModule("menu")}
              >
                <span>页面</span>
                <b>{stats.menuTotal}</b>
              </button>
            </aside>
          )}

          {/* ── 左下角搜索与翻页 ── */}
          <div className="pst-dock" aria-label="账号搜索与分页">
            <form
              className="pst-search"
              onSubmit={(event) => {
                event.preventDefault();
                setLocatedUserBanner("");
                setUserPage(1);
                setSearch(searchInput.trim());
                if (searchInput.trim()) {
                  setModuleCat("user");
                  setLayer("module");
                }
              }}
            >
              <svg viewBox="0 0 16 16" className="pst-search-ico" aria-hidden="true">
                <circle
                  cx="7"
                  cy="7"
                  r="4.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <path
                  d="m10.4 10.4 3 3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
              <input
                type="search"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="搜索账号或姓名…"
                aria-label="搜索账号"
              />
              {search && (
                <button
                  type="button"
                  className="pst-search-clear"
                  onClick={() => {
                    setSearchInput("");
                    setSearch("");
                    setUserPage(1);
                    setLocatedUserBanner("");
                  }}
                >
                  清除
                </button>
              )}
            </form>

            {layer === "module" && modulePagination && modulePagination.totalPages > 1 && (
              <div className="pst-pager">
                <button
                  type="button"
                  disabled={modulePagination.page <= 1}
                  onClick={() => setModulePage((prev) => Math.max(1, prev - 1))}
                >
                  上一页
                </button>
                <span>
                  {modulePagination.page} / {modulePagination.totalPages}
                </span>
                <button
                  type="button"
                  disabled={modulePagination.page >= modulePagination.totalPages}
                  onClick={() =>
                    setModulePage((prev) => Math.min(modulePagination.totalPages, prev + 1))
                  }
                >
                  下一页
                </button>
              </div>
            )}

            {graph.total_pages > 1 && (
              <div className="pst-pager">
                <button
                  type="button"
                  disabled={userPage <= 1 || loading}
                  onClick={() => setUserPage((prev) => Math.max(1, prev - 1))}
                >
                  上一页账号
                </button>
                <span>
                  {graph.page} / {graph.total_pages}
                </span>
                <button
                  type="button"
                  disabled={userPage >= graph.total_pages || loading}
                  onClick={() => setUserPage((prev) => Math.min(graph.total_pages, prev + 1))}
                >
                  下一页账号
                </button>
              </div>
            )}
          </div>

          {/* ── 右侧归属详情与快捷跳转面板 ── */}
          {entityInsight && (
            <aside className="pst-insight" aria-label="授权来源详情">
              <div className="pst-insight-head">
                <span className="pst-tag">{entityInsight.tag}</span>
                <button
                  type="button"
                  className="pst-close"
                  onClick={stepBack}
                  aria-label="关闭详情面板"
                  title="返回上一层"
                >
                  ×
                </button>
              </div>

              <h4 className="pst-insight-title">{entityInsight.title}</h4>
              {entityInsight.sub && <p className="pst-insight-sub">{entityInsight.sub}</p>}

              {entityInsight.actions.length > 0 && (
                <div className="pst-actions">
                  {entityInsight.actions.map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      className={action.primary ? "or-g53-btn-primary" : "or-g53-btn-tonal"}
                      onClick={action.onClick}
                    >
                      {action.label}
                    </button>
                  ))}
                </div>
              )}

              {entityInsight.groups.map((group) => (
                <div key={group.label} className="pst-group">
                  <div className="pst-group-label">{group.label}</div>
                  {group.items.length > 0 ? (
                    <div className="pst-chips">
                      {group.items.map((item) => (
                        <div key={item.id} className="pst-item-row">
                          <button
                            type="button"
                            className="pst-chip"
                            onClick={() => toEntity(group.cat, item.id)}
                          >
                            <div className="pst-chip-main">
                              <span className="pst-chip-name">{item.name}</span>
                              {item.sub && <em className="pst-chip-sub">{item.sub}</em>}
                            </div>
                            {item.badge && (
                              <span
                                className={`pst-chip-badge${
                                  item.badgeTone ? ` is-${item.badgeTone}` : ""
                                }`}
                              >
                                {item.badge}
                              </span>
                            )}
                          </button>
                          {item.jumpSection && onNavigateSection && (
                            <button
                              type="button"
                              className="pst-row-jump"
                              title={item.jumpLabel}
                              onClick={() => onNavigateSection(item.jumpSection!)}
                            >
                              打开页面
                            </button>
                          )}
                          {item.editUserId && onEditUserAccess && (
                            <button
                              type="button"
                              className="pst-row-jump"
                              onClick={() => onEditUserAccess(item.editUserId!, item.editUsername)}
                            >
                              改权限
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="pst-empty">暂无关联项</div>
                  )}
                </div>
              ))}
            </aside>
          )}
        </div>
      ) : (
        /* ── 角色 × 页面 权限矩阵视图 ── */
        <div className="permission-matrix-wrap">
          <div className="permission-matrix-legend" aria-label="矩阵图例">
            <span className="permission-matrix-legend__item is-explicit">
              <i /> 直接授予
            </span>
            <span className="permission-matrix-legend__item is-implied">
              <i /> 自动包含
            </span>
            <span className="permission-matrix-legend__item is-builtin">
              <i /> 系统内置
            </span>
            <span className="permission-matrix-legend__item is-none">
              <i /> 未授予
            </span>
            <span className="permission-matrix-legend__hint">
              点击任意角色或单元格，可切回星图查看对应链路
            </span>
          </div>

          <div className="mgmt-table-wrap permission-matrix">
            <table className="mgmt-table">
              <thead>
                <tr>
                  <th>页面 / 操作</th>
                  {graph.roles.map((role) => (
                    <th key={role.id}>
                      <button
                        type="button"
                        className="permission-matrix__role"
                        onClick={() => {
                          toEntity("role", role.id);
                          setActiveView("trace");
                        }}
                      >
                        <strong>{role.name}</strong>
                        <span>{role.user_count} 人</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {menuGroups.map((group) => (
                  <Fragment key={group.id}>
                    <tr className="permission-matrix__group-row">
                      <td colSpan={graph.roles.length + 1}>{group.label}</td>
                    </tr>
                    {group.menus.map((menu) => (
                      <tr key={menu.id}>
                        <td>
                          <button
                            type="button"
                            className="permission-matrix__menu"
                            onClick={() => {
                              toEntity("menu", menu.id);
                              setActiveView("trace");
                            }}
                          >
                            <strong>{menu.label}</strong>
                            <span>{menu.group}</span>
                          </button>
                        </td>
                        {graph.roles.map((role) => {
                          const state = roleMenuGrantState(role, menu);
                          const impliedBy =
                            state === "implied"
                              ? implicationSources(graph, role, permissionForMenu(menu)).map(
                                  (key) =>
                                    graph.catalog.find((item) => item.key === key)?.label ?? key,
                                )
                              : [];
                          const title = impliedBy.length
                            ? `经由「${impliedBy.join("、")}」隐含包含`
                            : `${role.name} × ${menu.label}：${grantStateLabel(state)}`;
                          return (
                            <td key={role.id}>
                              <button
                                type="button"
                                className={`permission-cell permission-cell--${state}`}
                                title={title}
                                aria-label={`${role.name} × ${menu.label}：${grantStateLabel(state)}`}
                                onClick={() => {
                                  toEntity("role", role.id);
                                  setActiveView("trace");
                                }}
                              >
                                {grantStateLabel(state)}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
