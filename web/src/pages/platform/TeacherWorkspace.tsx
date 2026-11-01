import type { ReactNode } from "react";
import "../../ui-redesign/g53/g53.css";

type Props = {
  children: ReactNode;
};

export function TeacherWorkspace({ children }: Props) {
  return <div className="or-g53-root or-g53-teacher-workspace contents">{children}</div>;
}
