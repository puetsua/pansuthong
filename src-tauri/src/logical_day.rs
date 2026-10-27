//! Logical calendar day helpers — ported from `src/lib/dates.ts` for MCP view filters.

use chrono::{Datelike, Local, NaiveDate};

/// YYYY-MM-DD of the current logical day in local time (see `todayIso` in TS).
pub fn today_iso(now: chrono::DateTime<Local>, day_start_hour: u32) -> String {
    let at = if day_start_hour > 0 {
        now - chrono::Duration::hours(day_start_hour as i64)
    } else {
        now
    };
    format_ymd(at.date_naive())
}

/// Logical day for a stored local-offset ISO timestamp string (`logicalDayOf` in TS).
pub fn logical_day_of(local_iso: &str, day_start_hour: u32) -> String {
    let date = local_iso.get(0..10).unwrap_or("");
    if day_start_hour == 0 || date.is_empty() {
        return date.to_string();
    }
    let hour = local_iso.get(11..13).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    if hour < day_start_hour {
        add_days_iso(date, -1)
    } else {
        date.to_string()
    }
}

/// ISO date `days` after `base_iso`, computed in UTC to avoid DST drift (`addDaysIso` in TS).
pub fn add_days_iso(base_iso: &str, days: i32) -> String {
    let parts: Vec<i32> = base_iso.split('-').filter_map(|s| s.parse().ok()).collect();
    if parts.len() != 3 {
        return base_iso.to_string();
    }
    let (y, m, d) = (parts[0], parts[1], parts[2]);
    let dt = chrono::NaiveDate::from_ymd_opt(y, m as u32, d as u32)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(1970, 1, 1).unwrap());
    format_ymd(dt + chrono::Duration::days(days as i64))
}

fn format_ymd(d: NaiveDate) -> String {
    format!("{:04}-{:02}-{:02}", d.year(), d.month(), d.day())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logical_day_midnight_rollover() {
        assert_eq!(
            logical_day_of("2026-06-11T00:05:00+08:00", 0),
            "2026-06-11"
        );
        assert_eq!(
            logical_day_of("2026-06-11T00:05:00+08:00", 3),
            "2026-06-10"
        );
        assert_eq!(
            logical_day_of("2026-06-11T02:59:00+08:00", 3),
            "2026-06-10"
        );
        assert_eq!(
            logical_day_of("2026-06-11T03:00:00+08:00", 3),
            "2026-06-11"
        );
        assert_eq!(
            logical_day_of("2026-06-11T23:59:00+08:00", 3),
            "2026-06-11"
        );
    }

    #[test]
    fn logical_day_uses_wall_clock_in_string() {
        assert_eq!(
            logical_day_of("2026-06-11T00:30:00+09:00", 3),
            "2026-06-10"
        );
        assert_eq!(
            logical_day_of("2026-06-11T00:30:00-05:00", 3),
            "2026-06-10"
        );
    }

    #[test]
    fn logical_day_month_boundary() {
        assert_eq!(
            logical_day_of("2026-06-01T01:00:00+08:00", 3),
            "2026-05-31"
        );
    }

    #[test]
    fn today_iso_respects_day_start() {
        use chrono::TimeZone;
        let dt = Local.with_ymd_and_hms(2026, 6, 11, 2, 0, 0).unwrap();
        assert_eq!(today_iso(dt, 3), "2026-06-10");
        assert_eq!(today_iso(dt, 0), "2026-06-11");
    }

    #[test]
    fn add_days_iso_matches_ts() {
        assert_eq!(add_days_iso("2026-06-11", 1), "2026-06-12");
        assert_eq!(add_days_iso("2026-06-11", -1), "2026-06-10");
        assert_eq!(add_days_iso("2026-03-01", -1), "2026-02-28");
    }
}
