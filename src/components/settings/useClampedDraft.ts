import { useEffect, useState } from "react";

/** Local string draft that resyncs from a committed number and clamps on blur/Enter. */
export function useClampedDraft(
  value: number,
  clamp: (raw: string | number) => number,
  apply: (n: number) => void,
) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const n = clamp(draft);
    setDraft(String(n));
    if (n !== value) apply(n);
  };
  return { draft, setDraft, commit };
}
