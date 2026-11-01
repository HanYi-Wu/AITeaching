import type { StudentAnswerImage, StudentQuestionRecord } from "../../platform/auth";

interface StudentQuestionNavProps {
  questions: StudentQuestionRecord[];
  answers: Record<string, string>;
  imageAnswers: Record<string, StudentAnswerImage[]>;
}

export function StudentQuestionNav({
  questions,
  answers,
  imageAnswers,
}: StudentQuestionNavProps) {
  return (
    <nav
      className="or-g54-qnav-scroll mb-5 flex items-center gap-2 overflow-x-auto pb-2 pt-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
      aria-label="答题导航"
    >
      {questions.map((question, index) => {
        const isAnswered =
          Boolean((answers[question.question_id] ?? "").trim()) ||
          (imageAnswers[question.question_id]?.length ?? 0) > 0;

        return (
          <a
            key={question.question_id}
            href={`#student-question-${index + 1}`}
            data-answered={isAnswered ? "true" : "false"}
            className={`or-g54-qnav-btn inline-flex h-9 min-w-9 shrink-0 items-center justify-center px-2.5 text-xs font-semibold transition-all ${
              isAnswered ? "font-bold" : ""
            }`}
          >
            {index + 1}
          </a>
        );
      })}
    </nav>
  );
}
