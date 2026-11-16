import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { apiGraphQuestionBindingsIndex } from "../../api/client";
import { useContentLibraryChanged } from "../../lib/contentEvents";
import { loadSessionToken } from "../../platform/session";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import type { BankFolders } from "../../components/BankFolderExplorer";
import type { BankCollectionRow, BankListItem, BankReadDiagnostic } from "./bankModel";
import {
  fetchBankCorePayload,
  getBankPrefetchScopeKey,
  invalidateBankPrefetch,
  peekBankPrefetchSnapshot,
  peekInFlightBankPrefetch,
} from "./bankPrefetch";
import {
  filterBankList,
  filterMetadataScopeItems,
} from "./listing/bankFilterPipeline";

export interface UseBankListOptions {
  onError: (msg: string | null) => void;
  ignoreContentChangeSource?: object;
  projectScope?: string | null;
}

export function useBankList({ onError, ignoreContentChangeSource, projectScope }: UseBankListOptions) {
  const { t } = useTranslation(["bank", "lib", "common"]);
  const scopeKey = getBankPrefetchScopeKey(projectScope);
  const [initialPrefetch] = useState(() => peekBankPrefetchSnapshot(scopeKey));
  const [items, setItems] = useState<BankListItem[]>(() => initialPrefetch?.items ?? []);
  const [diagnostics, setDiagnostics] = useState<BankReadDiagnostic[]>(() => initialPrefetch?.diagnostics ?? []);
  const [folders, setFolders] = useState<BankFolders>(() => initialPrefetch?.folders ?? { folders: [], assignments: {} });
  const [collections, setCollections] = useState<BankCollectionRow[]>(() => initialPrefetch?.collections ?? []);
  const [subjects, setSubjects] = useState<string[]>(() => initialPrefetch?.subjects ?? []);
  const [filterSubject, setFilterSubject] = useState<string>("__all__");
  const [filterCollection, setFilterCollection] = useState<string>("__all__");
  const [filterType, setFilterType] = useState<string>("__all__");
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [metadataFilters, setMetadataFilters] = useState<MetadataFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [graphLinkIndex, setGraphLinkIndex] = useState<
    Record<string, { id: string; canonical_name: string; node_kind: string }[]>
  >(() => initialPrefetch?.graphLinkIndex ?? {});
  const [loading, setLoading] = useState(() => !initialPrefetch);
  const [hasLoaded, setHasLoaded] = useState(() => Boolean(initialPrefetch));

  const reqSeqRef = useRef(0);
  const searchCache = useMemo(() => new WeakMap<BankListItem, string>(), [items]);

  const loadList = useCallback(async (options?: { reusePrefetch?: boolean }) => {
    const currentSeq = ++reqSeqRef.current;
    const session = loadSessionToken();
    const isCurrent = () => currentSeq === reqSeqRef.current && session === loadSessionToken();
    onError(null);
    setLoading(true);
    try {
      const inFlight = options?.reusePrefetch ? peekInFlightBankPrefetch(scopeKey) : null;
      if (inFlight) {
        const snapshot = await inFlight;
        if (!isCurrent()) {
          return;
        }
        setCollections(snapshot.collections);
        setItems(snapshot.items);
        setDiagnostics(snapshot.diagnostics);
        setFolders(snapshot.folders);
        setSubjects(snapshot.subjects);
        setGraphLinkIndex(snapshot.graphLinkIndex);
        return;
      }

      if (!options?.reusePrefetch) {
        invalidateBankPrefetch();
      }
      const core = await fetchBankCorePayload();

      if (!isCurrent()) {
        return;
      }

      setCollections(core.collections);
      setItems(core.items);
      setDiagnostics(core.diagnostics);
      setFolders(core.folders);
      setSubjects(core.subjects);

      try {
        const idx = await apiGraphQuestionBindingsIndex();
        if (isCurrent()) {
          setGraphLinkIndex(idx.index ?? {});
        }
      } catch {
        if (isCurrent()) {
          setGraphLinkIndex({});
        }
      }
    } catch (e) {
      if (isCurrent()) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setHasLoaded(true);
      }
    }
  }, [onError, scopeKey]);

  useEffect(() => {
    if (!initialPrefetch) {
      void loadList({ reusePrefetch: true });
    }
    return () => {
      // Invalidate in-flight requests on unmount
      reqSeqRef.current++;
    };
  }, [initialPrefetch, loadList]);

  useContentLibraryChanged((kind) => {
    if (kind === "question") {
      void loadList();
    }
  }, ignoreContentChangeSource);

  const commitSearch = useCallback((value: string) => {
    setSearch(value);
  }, []);

  const collectionOptions = useMemo(() => {
    if (filterSubject === "__all__") {
      return collections;
    }
    return collections.filter((c) => {
      if (c.id === "main") {
        return filterSubject === "main";
      }
      return c.id.startsWith(`${filterSubject}/`);
    });
  }, [collections, filterSubject]);

  const metadataScopeItems = useMemo(
    () => filterMetadataScopeItems(items, filterSubject, filterCollection, filterType),
    [items, filterSubject, filterCollection, filterType],
  );

  const metadataFilterDefinitions = useMemo(
    () => buildMetadataFilterDefinitions(metadataScopeItems),
    [metadataScopeItems],
  );

  const deferredSearch = useDeferredValue(search);
  const deferredMetadataFilters = useDeferredValue(metadataFilters);

  const activeMetadataFilters = useMemo(
    () => (hasActiveMetadataFilters(deferredMetadataFilters) ? deferredMetadataFilters : null),
    [deferredMetadataFilters],
  );

  const filtered = useMemo(
    () =>
      filterBankList(
        metadataScopeItems,
        deferredSearch,
        filterCategory,
        activeMetadataFilters,
        searchCache,
      ),
    [activeMetadataFilters, metadataScopeItems, deferredSearch, filterCategory, searchCache],
  );

  const bankFilterSummary = useMemo(() => {
    const all = t("bank:filterAllLabel");
    const sub = filterSubject === "__all__" ? all : filterSubject;
    const collLabel =
      filterCollection === "__all__"
        ? all
        : collections.find((c) => c.id === filterCollection)?.label ?? filterCollection;
    const typLabel =
      filterType === "__all__"
        ? all
        : filterType === "group"
          ? t("bank:typeGroup")
          : t(`lib:questionTypes.${filterType}`);
    const searchSuffix = search.trim() ? t("bank:filterSearchActive") : "";
    const tagSuffix = hasActiveMetadataFilters(metadataFilters) ? " · metadata" : "";
    return `${sub} · ${collLabel} · ${typLabel}${searchSuffix}${tagSuffix}`;
  }, [filterSubject, filterCollection, filterType, search, metadataFilters, collections, t]);

  return {
    items,
    diagnostics,
    setItems,
    folders,
    setFolders,
    collections,
    setCollections,
    subjects,
    setSubjects,
    filterSubject,
    setFilterSubject,
    filterCollection,
    setFilterCollection,
    filterType,
    setFilterType,
    filterCategory,
    setFilterCategory,
    metadataFilters,
    setMetadataFilters,
    searchInput,
    setSearchInput,
    search,
    setSearch,
    commitSearch,
    graphLinkIndex,
    setGraphLinkIndex,
    loading,
    hasLoaded,
    loadList,
    collectionOptions,
    metadataScopeItems,
    metadataFilterDefinitions,
    filtered,
    bankFilterSummary,
  };
}
