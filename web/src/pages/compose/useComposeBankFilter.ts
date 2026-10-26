import { useDeferredValue, useMemo } from "react";
import { collapseGroupRowsForList } from "../../lib/groupQuestions";
import {
  buildMetadataFilterDefinitions,
  hasActiveMetadataFilters,
  matchesMetadataFilters,
  type MetadataFilters,
} from "../../lib/metadataFilters";
import { normalizeQuestionTypeForFilter } from "../../lib/questionTypes";
import type { QuestionRow } from "../../types/compose";
import { questionTypeMatchesSection } from "./composeHelpers";

/** Keep metadata choices scoped to the subject, collection, and question type. */
export function useComposeBankFilter({
  questions, subject, namespaceFilter, typeFilter, metadataFilters, search,
}: {
  questions: QuestionRow[];
  subject: string;
  namespaceFilter: string;
  typeFilter: string;
  metadataFilters: MetadataFilters;
  search: string;
}) {
  const questionsForSubject = useMemo(() => {
    const s = subject.trim();
    return questions.filter((q) => (q.subject ?? "") === s);
  }, [questions, subject]);

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
    return collapsedQuestionsForSubject.filter((q) => {
      const coll = q.collection ?? q.namespace;
      if (ns && coll !== ns) {
        return false;
      }
      if (typeFilter !== "__all__" && !questionTypeMatchesSection(q.type, typeFilter, q.answer)) {
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
  const activeMetadataFilters = useMemo(
    () => (hasActiveMetadataFilters(deferredMetadataFilters) ? deferredMetadataFilters : null),
    [deferredMetadataFilters],
  );
  const metadataScopeSearchQuestions = useMemo(
    () =>
      metadataScopeQuestions.map((question) => ({
        question,
        searchText: [
          question.id,
          question.qualified_id,
          question.content_preview,
          normalizeQuestionTypeForFilter(question.type, question.answer),
          question.group_id ?? "",
          question.group_material ?? "",
          JSON.stringify(question.metadata ?? {}),
        ]
          .join("\n")
          .toLowerCase(),
      })),
    [metadataScopeQuestions],
  );

  const filteredQuestions = useMemo(() => {
    const qlow = deferredSearch.trim().toLowerCase();
    return metadataScopeSearchQuestions
      .filter(({ question, searchText }) => {
        if (activeMetadataFilters && !matchesMetadataFilters(question.metadata, activeMetadataFilters)) {
          return false;
        }
        return !qlow || searchText.includes(qlow);
      })
      .map(({ question }) => question);
  }, [activeMetadataFilters, metadataScopeSearchQuestions, deferredSearch]);
  return { namespaces, metadataFilterDefinitions, filteredQuestions };
}
