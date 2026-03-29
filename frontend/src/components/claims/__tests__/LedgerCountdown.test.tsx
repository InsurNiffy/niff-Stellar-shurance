/**
 * Unit tests for LedgerCountdown component.
 * Covers: display formatting, deadline-passed state, interval cleanup.
 */

import React from "react";
import { render, screen, act } from "@testing-library/react";
import { LedgerCountdown } from "../LedgerCountdown";

// Stub useState so the component renders as if mounted (bypasses SSR guard).
jest.mock("react", () => {
  const actual = jest.requireActual<typeof React>("react");
  return {
    ...actual,
    useState: <T,>(init: T | (() => T)) => {
      // For the `mounted` boolean state, return true immediately.
      if (init === false) return [true, jest.fn()];
      return actual.useState(init);
    },
  };
});

describe("LedgerCountdown", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows "Deadline passed" when currentLedger >= targetLedger', () => {
    render(
      <LedgerCountdown
        targetLedger={100}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    expect(screen.getByTestId("deadline-passed")).toHaveTextContent(
      "Deadline passed"
    );
  });

  it('shows "Deadline passed" when currentLedger > targetLedger', () => {
    render(
      <LedgerCountdown
        targetLedger={100}
        currentLedger={150}
        avgCloseSeconds={5}
      />
    );
    expect(screen.getByTestId("deadline-passed")).toBeInTheDocument();
  });

  it("displays ~ prefix on all future countdowns", () => {
    render(
      <LedgerCountdown
        targetLedger={1000}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    const el = screen.getByTestId("ledger-countdown");
    expect(el.textContent).toMatch(/^~/);
  });

  it("shows days when remaining time exceeds 24 hours", () => {
    // 10000 ledgers * 5s = 50000s ≈ 13.8 hours — use larger gap for days
    // 100000 ledgers * 5s = 500000s ≈ 5.7 days
    render(
      <LedgerCountdown
        targetLedger={100100}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    const el = screen.getByTestId("ledger-countdown");
    expect(el.textContent).toMatch(/\d+d/);
  });

  it("shows hours and minutes for sub-day countdowns", () => {
    // 720 ledgers * 5s = 3600s = 1 hour
    render(
      <LedgerCountdown
        targetLedger={820}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    const el = screen.getByTestId("ledger-countdown");
    expect(el.textContent).toMatch(/1h/);
  });

  it("includes (approximate) caveat text", () => {
    render(
      <LedgerCountdown
        targetLedger={1000}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    expect(screen.getByText("(approximate)")).toBeInTheDocument();
  });

  it("advances ledger estimate after avgCloseSeconds interval", () => {
    render(
      <LedgerCountdown
        targetLedger={1000}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );

    const before = screen.getByTestId("ledger-countdown").textContent;

    act(() => {
      jest.advanceTimersByTime(5000); // one ledger close
    });

    const after = screen.getByTestId("ledger-countdown").textContent;
    // The countdown should have decreased (fewer remaining ledgers).
    expect(after).not.toBe(before);
  });

  it("cleans up interval on unmount without memory leaks", () => {
    const clearSpy = jest.spyOn(global, "clearInterval");
    const { unmount } = render(
      <LedgerCountdown
        targetLedger={1000}
        currentLedger={100}
        avgCloseSeconds={5}
      />
    );
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
