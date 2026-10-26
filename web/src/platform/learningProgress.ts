/**
 * Platform learning progress comparison API client (C17 / C18 / C19).
 */

import { apiGet } from "../api/client";

export interface NodeComparisonItem {
  knowledge_node_id: string;
  status: string;
  is_modified: boolean;
  pre_score: number | null;
  pre_max_score: number | null;
  pre_rate: number | null;
  pre_percentage: number | null;
  post_score: number | null;
  post_max_score: number | null;
  post_rate: number | null;
  post_percentage: number | null;
  delta_percentage_points: number | null;
  pre_question_count: number;
  post_question_count: number;
  question_difference: number;
  incomparable_reason: string | null;
}

export interface StudentComparisonDetail {
  status: string;
  is_source_modified: boolean;
  is_source_missing: boolean;
  node_comparisons: NodeComparisonItem[];
}

export interface ClassNodeSummary {
  knowledge_node_id: string;
  status: string;
  is_modified: boolean;
  matched_sample_size: number;
  pre_class_percentage: number | null;
  post_class_percentage: number | null;
  delta_percentage_points: number | null;
  pre_question_count: number;
  post_question_count: number;
  question_difference: number;
  incomparable_reason: string | null;
}

export interface ClassComparisonDetail {
  status: string;
  is_source_modified: boolean;
  is_source_missing: boolean;
  matched_students: string[];
  node_summaries: ClassNodeSummary[];
}

export interface TeacherComparisonResponse {
  practice_publication_id: string;
  class_id?: string | null;
  source_status: {
    status: string;
    source_type: string;
    source_ref_id: string;
    is_modified: boolean;
    is_missing: boolean;
    reason: string | null;
  };
  class_comparison: ClassComparisonDetail;
  student_comparisons: Record<string, StudentComparisonDetail>;
}

export interface StudentComparisonResponse {
  practice_publication_id: string;
  student_id: string;
  source_status: {
    status: string;
    source_type: string;
    source_ref_id: string;
    is_modified: boolean;
    is_missing: boolean;
    reason: string | null;
  };
  comparison: StudentComparisonDetail;
}

export async function fetchTeacherLearningProgressComparison(params: {
  practicePublicationId: string;
  classId?: string;
  studentId?: string;
}): Promise<TeacherComparisonResponse> {
  const query = new URLSearchParams();
  query.set("practice_publication_id", params.practicePublicationId);
  if (params.classId) query.set("class_id", params.classId);
  if (params.studentId) query.set("student_id", params.studentId);
  return apiGet<TeacherComparisonResponse>(`/api/learning-progress/teacher/comparison?${query.toString()}`);
}

export async function fetchStudentLearningProgressComparison(params: {
  practicePublicationId: string;
  studentId?: string;
}): Promise<StudentComparisonResponse> {
  const query = new URLSearchParams();
  query.set("practice_publication_id", params.practicePublicationId);
  if (params.studentId) query.set("student_id", params.studentId);
  return apiGet<StudentComparisonResponse>(`/api/learning-progress/student/comparison?${query.toString()}`);
}
