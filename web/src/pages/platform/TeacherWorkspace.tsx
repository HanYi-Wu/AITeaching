import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
};

export function TeacherWorkspace({ children }: Props) {
  return <>{children}</>;
}
