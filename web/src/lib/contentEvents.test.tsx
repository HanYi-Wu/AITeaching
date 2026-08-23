import { render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { notifyContentLibraryChanged, useContentLibraryChanged } from "./contentEvents";

function Harness() {
  const [count, setCount] = useState(0);
  useContentLibraryChanged(() => setCount((value) => value + 1));
  return <span data-testid="count">{count}</span>;
}

describe("content library events", () => {
  it("notifies an already-mounted compose workspace after content changes", async () => {
    const view = render(<Harness />);

    notifyContentLibraryChanged("question");

    await waitFor(() => expect(view.getByTestId("count")).toHaveTextContent("1"));
  });
});
