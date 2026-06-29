import { PAGE_SIZES } from "../lib/listPaging";

type DateRangeFiltersProps = {
  from: string;
  to: string;
  fromLabel: string;
  toLabel: string;
  fromAriaLabel: string;
  toAriaLabel: string;
  clearLabel: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClear: () => void;
};

export function DateRangeFilters({
  from,
  to,
  fromLabel,
  toLabel,
  fromAriaLabel,
  toAriaLabel,
  clearLabel,
  onFromChange,
  onToChange,
  onClear,
}: DateRangeFiltersProps) {
  return (
    <>
      <label className="archived-filter">
        <span>{fromLabel}</span>
        <input
          type="date"
          aria-label={fromAriaLabel}
          value={from}
          max={to || undefined}
          onChange={e => onFromChange(e.currentTarget.value)}
        />
      </label>
      <label className="archived-filter">
        <span>{toLabel}</span>
        <input
          type="date"
          aria-label={toAriaLabel}
          value={to}
          min={from || undefined}
          onChange={e => onToChange(e.currentTarget.value)}
        />
      </label>
      {(from || to) && (
        <button type="button" className="archived-clear" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </>
  );
}

type PaginationControlsProps = {
  current: number;
  totalPages: number;
  previousLabel: string;
  nextLabel: string;
  previousAriaLabel: string;
  nextAriaLabel: string;
  status: string;
  onPageChange: (page: number) => void;
};

export function PaginationControls({
  current,
  totalPages,
  previousLabel,
  nextLabel,
  previousAriaLabel,
  nextAriaLabel,
  status,
  onPageChange,
}: PaginationControlsProps) {
  if (totalPages <= 1) return null;

  return (
    <div className="pagination">
      <button
        type="button"
        className="pagination-btn"
        aria-label={previousAriaLabel}
        disabled={current <= 1}
        onClick={() => onPageChange(current - 1)}
      >
        {previousLabel}
      </button>
      <span className="pagination-status">{status}</span>
      <button
        type="button"
        className="pagination-btn"
        aria-label={nextAriaLabel}
        disabled={current >= totalPages}
        onClick={() => onPageChange(current + 1)}
      >
        {nextLabel}
      </button>
    </div>
  );
}

type PageSizeSelectProps = {
  label: string;
  ariaLabel: string;
  value: number;
  onChange: (value: number) => void;
};

export function PageSizeSelect({ label, ariaLabel, value, onChange }: PageSizeSelectProps) {
  return (
    <label className="pagination-size">
      {label}{" "}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={e => onChange(Number(e.currentTarget.value))}
      >
        {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
      </select>
    </label>
  );
}
