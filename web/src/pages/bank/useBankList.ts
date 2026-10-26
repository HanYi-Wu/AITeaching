import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { apiGet, apiGraphQuestionBindingsIndex } from "../../api/client";
import { useContentLibraryChanged } from "../../lib/contentEvents";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  matchesMetadataFilters,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import type { BankFolders } from "../../components/BankFolderExplorer";
import type { BankCollectionRow, BankListItem } from "./bankModel";

export interface UseBankListOptions {
  onError: (msg: string | null) => void;
}

export function useBankList({ onError }: UseBankListOptions) {
  const { t } = useTranslation(["bank", "lib", "common"]);
  const [items, setItems] = useState<BankListItem[]>([]);
  const [folders, setFolders] = useState<BankFolders>({ folders: [], assignments: {} });
  const [collections, setCollections] = useState<BankCollectionRow[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [filterSubject, setFilterSubject] = useState<string>("__all__");
  const [filterCollection, setFilterCollection] = useState<string>("__all__");
  const [filterType, setFilterType] = useState<string>("__all__");
  const [filterCategory, setFilterCategory] = useState<string>("__all__");
  const [metadataFilters, setMetadataFilters] = useState<MetadataFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [graphLinkIndex, setGraphLinkIndex] = useState<
    Record<string, { id: string; canonical_name: string; node_kind: string }[]>
  >({});
  const [loading, setLoading] = useState(false);

  const reqSeqRef = useRef(0);

  const loadList = useCallback(async () => {
    const currentSeq = ++reqSeqRef.current;
    onError(null);
    setLoading(true);
    try {
      const [c, it, sub, folderData] = await Promise.all([
        apiGet<{
          collections: { id: string; label: string; subject?: string; collection?: string }[];
        }>("/api/bank/collections"),
        apiGet<{ items: BankListItem[] }>("/api/bank/items"),
        apiGet<{ subjects: string[] }>("/api/bank/subjects"),
        apiGet<BankFolders>("/api/bank/folders"),
      ]);

      if (currentSeq !== reqSeqRef.current) {
        return;
      }

      const parsedCollections = c.collections.map((x) => {
        const parts = x.id.split("/");
        const subj = x.subject ?? parts[0] ?? "";
        const coll =
          x.collection ?? (parts.length > 1 ? parts.slice(1).join("/") : parts[0] ?? "");
        return { id: x.id, label: x.label, subject: subj, collection: coll };
      });

      setCollections(parsedCollections);
      setItems(it.items);
      setFolders(folderData);
      setSubjects(sub.subjects);

      try {
        const idx = await apiGraphQuestionBindingsIndex();
        if (currentSeq === reqSeqRef.current) {
          setGraphLinkIndex(idx.index ?? {});
        }
      } catch {
        if (currentSeq === reqSeqRef.current) {
          setGraphLinkIndex({});
        }
      }
    } catch (e) {
      if (currentSeq === reqSeqRef.current) {
        onError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (currentSeq === reqSeqRef.current) {
        setLoading(false);
      }
    }
  }, [onError]);

  useEffect(() => {
    void loadList();
    return () => {
      // Invalidate in-flight requests on unmount
      reqSeqRef.current++;
    };
  }, [loadList]);

  useContentLibraryChanged((kind) => {
    if (kind === "question") {
      void loadList();
    }
  });

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

  const metadataScopeItems = useMemo(() => {
    return items.filter((it) => {
      if (filterSubject !== "__all__" && (it.subject ?? "") !== filterSubject) {
        return false;
      }
      if (filterCollection !== "__all__" && it.collection !== filterCollection) {
        return false;
      }
      if (filterType !== "__all__" && it.type !== filterType) {
        return false;
      }
      return true;
    });
  }, [items, filterSubject, filterCollection, filterType]);

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

  const metadataScopeSearchItems = useMemo(
    () =>
      metadataScopeItems.map((it) => ({
        item: it,
        searchText: [
          it.qualified_id,
          it.content_preview,
          it.group_id ?? "",
          it.group_material ?? "",
          JSON.stringify(it.metadata ?? {}),
        ]
          .join("\n")
          .toLowerCase(),
      })),
    [metadataScopeItems],
  );

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return metadataScopeSearchItems
      .filter(({ item, searchText }) => {
        if (
          filterCategory !== "__all__" &&
          String(item.metadata?.category || "未分类") !== filterCategory
        ) {
          return false;
        }
        if (activeMetadataFilters && !matchesMetadataFilters(item.metadata, activeMetadataFilters)) {
          return false;
        }
        return !q || searchText.includes(q);
      })
      .map(({ item }) => item);
  }, [activeMetadataFilters, metadataScopeSearchItems, deferredSearch, filterCategory]);

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
    loadList,
    collectionOptions,
    metadataScopeItems,
    metadataFilterDefinitions,
    filtered,
    bankFilterSummary,
  };
}
