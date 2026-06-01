import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { Document } from "../lib/tauri";

// Capture the "store-changed" listener so tests can fire a reload, and mock the
// IPC document fetch so we drive load success/failure deterministically (#42).
let storeChangedCb: (() => void) | undefined;
const unlistenFn = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: () => void) => {
    if (event === "store-changed") storeChangedCb = cb;
    return Promise.resolve(unlistenFn);
  }),
}));
vi.mock("../lib/tauri", () => ({ api: { getDocument: vi.fn() } }));

import { api } from "../lib/tauri";
import { useDocument } from "./store";

const getDocument = vi.mocked(api.getDocument);

function makeDoc(theme: "auto" | "light" | "dark" = "auto"): Document {
  return {
    version: 2,
    last_modified: undefined,
    settings: { theme, sort_order: "priority" },
    tags: [],
    tasks: [],
    template_tasks: [],
  };
}

beforeEach(() => {
  storeChangedCb = undefined;
  getDocument.mockReset();
});

describe("useDocument", () => {
  it("loads the document on mount and builds indexes", async () => {
    const doc = makeDoc();
    getDocument.mockResolvedValue(doc);

    const { result } = renderHook(() => useDocument());

    await waitFor(() => expect(result.current.doc).toBe(doc));
    expect(result.current.error).toBeNull();
    expect(result.current.reloadError).toBeNull();
    expect(result.current.indexes).not.toBeNull();
  });

  it("reloads when a store-changed event fires", async () => {
    const doc1 = makeDoc("auto");
    const doc2 = makeDoc("dark");
    getDocument.mockResolvedValue(doc1);

    const { result } = renderHook(() => useDocument());
    await waitFor(() => expect(result.current.doc).toBe(doc1));

    getDocument.mockResolvedValue(doc2);
    await act(async () => { storeChangedCb?.(); });

    await waitFor(() => expect(result.current.doc).toBe(doc2));
  });

  it("treats a failed first load as fatal (error set, no doc)", async () => {
    getDocument.mockRejectedValue("boom");

    const { result } = renderHook(() => useDocument());

    await waitFor(() => expect(result.current.error).toBe("boom"));
    expect(result.current.doc).toBeNull();
    expect(result.current.indexes).toBeNull();
  });

  it("degrades a later reload failure to a dismissible banner, keeping the last-good doc", async () => {
    const doc1 = makeDoc();
    getDocument.mockResolvedValue(doc1);

    const { result } = renderHook(() => useDocument());
    await waitFor(() => expect(result.current.doc).toBe(doc1));

    getDocument.mockRejectedValue("network down");
    await act(async () => { storeChangedCb?.(); });

    await waitFor(() => expect(result.current.reloadError).toBe("network down"));
    expect(result.current.doc).toBe(doc1); // last-good doc stays on screen
    expect(result.current.error).toBeNull(); // not fatal

    act(() => result.current.dismissReloadError());
    await waitFor(() => expect(result.current.reloadError).toBeNull());
  });
});
