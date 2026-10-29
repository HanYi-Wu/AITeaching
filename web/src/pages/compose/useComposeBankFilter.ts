import { useDeferredValue, useMemo } from "react";
import { collapseGroupRowsForList } from "../../lib/groupQuestions";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import type { QuestionRow } from "../../types/compose";
import { questionTypeMatchesSection } from "./composeHelpers";
import { compileMetadataFilters } from "./bank-search/metadataFilterMatcher";
import { getQuestionSearchText } from "./bank-search/questionSearchIndex";

/** Keep metadata choices scoped to the subject, collection, and question type. */
export function useComposeBankFilter({
  questions,
  subject,
  namespaceFilter,
  typeFilter,
  metadataFilters,
  search,
}: {
  questions: QuestionRow[];
  subject: string;
  namespaceFilter: string;
  typeFilter: string;
  metadataFilters: MetadataFilters;
  search: string;
}) {
  const searchTextCache = useMemo(
    () => new WeakMap<QuestionRow, string>(),
    [questions],
  );

  const questionsBySubject = useMemo(() => {
    const bySubject = new Map<string, QuestionRow[]>();
    for (const question of questions) {
      const key = question.subject ?? "";
      let group = bySubject.get(key);
      if (!group) {
        group = [];
        bySubject.set(key, group);
      }
      group.push(question);
    }
    return bySubject;
  }, [questions]);

  const questionsForSubject = useMemo(() => {
    const s = subject.trim();
    return questionsBySubject.get(s) ?? [];
  }, [questionsBySubject, subject]);

  const namespaces = useMemo(() => {
    const s = new Set<string>();
    for (const q of questionsForSubject) {
      s.add(q.collection ?? q.namespace);
    }
    return [...s].sort();
  }, [questionsForSubject]);

  const collapsedQuestionsForSubject = useMemo(
    () => collapseGroupRowsForList(questionsForSubject),
    [questionsForSubject],
  );

  const metadataScopeQuestions = useMemo(() => {
    const ns = namespaceFilter === "__all__" ? null : namespaceFilter;
    const allTypes = typeFilter === "__all__";
    if (!ns && allTypes) {
      return collapsedQuestionsForSubject;
    }
    return collapsedQuestionsForSubject.filter((q) => {
      const coll = q.collection ?? q.namespace;
      if (ns && coll !== ns) {
        return false;
      }
      if (!allTypes && !questionTypeMatchesSection(q.type, typeFilter, q.answer)) {
        return false;
      }
      return true;
    });
  }, [collapsedQuestionsForSubject, namespaceFilter, typeFilter]);

  const metadataFilterDefinitions = useMemo(
    () => buildMetadataFilterDefinitions(metadataScopeQuestions),
    [metadataScopeQuestions],
  );
  const deferredSearch = useDeferredValue(search);
  const deferredMetadataFilters = useDeferredValue(metadataFilters);
  const metadataMatcher = useMemo(
    () =>
      hasActiveMetadataFilters(deferredMetadataFilters)
        ? compileMetadataFilters(deferredMetadataFilters)
        : null,
    [deferredMetadataFilters],
  );

  const filteredQuestions = useMemo(() => {
    const qlow = deferredSearch.trim().toLowerCase();
    const hasSearch = qlow.length > 0;

    if (!metadataMatcher && !hasSearch) {
      return metadataScopeQuestions;
    }

    return metadataScopeQuestions.filter((question) => {
      if (metadataMatcher && !metadataMatcher(question.metadata)) {
        return false;
      }
      if (hasSearch && !getQuestionSearchText(question, searchTextCache).includes(qlow)) {
        return false;
      }
      return true;
    });
  }, [metadataMatcher, metadataScopeQuestions, deferredSearch, searchTextCache]);
  return { namespaces, metadataFilterDefinitions, filteredQuestions };
}
