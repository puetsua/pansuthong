use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct ParsedInput {
    pub title: String,
    pub tag_names: Vec<String>,
    pub due_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
    pub estimated_seconds: Option<i64>,
}

/// Upper bound for an estimate: 100,000 minutes. Mirrors the TS `ESTIMATED_SECONDS_MAX`
/// and the backend's `validate_estimated_seconds` range.
const ESTIMATED_SECONDS_MAX: i64 = 100_000 * 60;

/// Pure: takes the composer's raw string and "today" reference; returns structured tokens.
/// Unknown text becomes part of the title.
pub fn parse(input: &str, today: NaiveDate) -> ParsedInput {
    let mut out = ParsedInput::default();
    let mut title_parts: Vec<&str> = Vec::new();

    let tokens = tokenize(input);
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        if let Some(name) = tag_from_token(tok) {
            out.tag_names.push(name);
            i += 1;
            continue;
        }
        // `~1h30m` / `~45m` / `~30` (bare = minutes) sets the estimate; last one wins.
        // An unparseable or out-of-range `~token` falls through to the title.
        if let Some(seconds) = estimate_from_token(tok) {
            out.estimated_seconds = Some(seconds);
            i += 1;
            continue;
        }
        // "start" is the current keyword; "sched"/"scheduled" stay as aliases (#renamed).
        if (tok == "due" || tok == "start" || tok == "sched" || tok == "scheduled")
            && i + 1 < tokens.len()
        {
            if let Some(d) = parse_date(tokens[i + 1], today) {
                if tok == "due" {
                    out.due_date = Some(d);
                } else {
                    out.start_date = Some(d);
                }
                i += 2;
                continue;
            }
        }
        title_parts.push(tok);
        i += 1;
    }

    out.title = title_parts.join(" ").trim().to_string();
    out
}

/// Split into tokens where a `#"…"` run is kept whole (spaces and all); every
/// other token is a maximal run of non-whitespace. An unterminated `#"foo bar`
/// runs to end-of-input. Scanning for the `"` byte is UTF-8 safe — 0x22 never
/// appears inside a multi-byte sequence.
fn tokenize(input: &str) -> Vec<&str> {
    let bytes = input.as_bytes();
    let n = bytes.len();
    let mut tokens = Vec::new();
    let mut i = 0;
    while i < n {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        if bytes[i] == b'#' && i + 1 < n && bytes[i + 1] == b'"' {
            i += 2; // past the opening `#"`
            while i < n && bytes[i] != b'"' {
                i += 1;
            }
            if i < n {
                i += 1;
            } // consume the closing quote when present
        } else {
            while i < n && !bytes[i].is_ascii_whitespace() {
                i += 1;
            }
        }
        tokens.push(&input[start..i]);
    }
    tokens
}

/// A tag name from a token, or None if it isn't a tag (no `#`, or an empty name
/// like a bare `#` / `#""`). `#"phrase with spaces"` unwraps the quotes; `#word`
/// keeps its existing meaning. Names are trimmed of surrounding whitespace.
fn tag_from_token(tok: &str) -> Option<String> {
    let rest = tok.strip_prefix('#')?;
    let name = match rest.strip_prefix('"') {
        Some(inner) => inner.strip_suffix('"').unwrap_or(inner),
        None => rest,
    };
    let name = name.trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Seconds from a `~duration` token, or None if it isn't a valid estimate (no `~`,
/// empty, unparseable, or outside 1..=ESTIMATED_SECONDS_MAX). Mirrors the TS
/// `estimateFromToken`/`parseEstimatedSeconds` so `~1h30m` agrees with the editor.
fn estimate_from_token(tok: &str) -> Option<i64> {
    let rest = tok.strip_prefix('~')?;
    let seconds = parse_estimate_duration(rest)?;
    if (1..=ESTIMATED_SECONDS_MAX).contains(&seconds) {
        Some(seconds)
    } else {
        None
    }
}

/// Duration text -> whole seconds, mirroring TS `parseEstimatedSeconds`: a bare
/// number is minutes, a leading `P`/`p` is an ISO-8601 duration, otherwise a run
/// of `d`/`h`/`m`/`s` unit segments. None on any malformed input.
fn parse_estimate_duration(raw: &str) -> Option<i64> {
    let t = raw.trim();
    if t.is_empty() {
        return None;
    }
    if t.bytes().all(|b| b.is_ascii_digit()) {
        return t.parse::<i64>().ok()?.checked_mul(60);
    }
    if t.starts_with('P') || t.starts_with('p') {
        return parse_iso_duration(t);
    }
    parse_unit_duration(t)
}

/// `1h30m`, `45m`, `1 h 30 m` -> seconds. Each segment is digits, optional
/// whitespace, then one of `d`/`h`/`m`/`s`; segments are separated only by
/// whitespace. Anything else (a stray unit, trailing text, a number with no unit)
/// is None.
fn parse_unit_duration(raw: &str) -> Option<i64> {
    let bytes = raw.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    let mut total: i64 = 0;
    let mut found = false;
    while i < n {
        if bytes[i].is_ascii_whitespace() {
            i += 1;
            continue;
        }
        if !bytes[i].is_ascii_digit() {
            return None;
        }
        let start = i;
        while i < n && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let num: i64 = raw[start..i].parse().ok()?;
        while i < n && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if i >= n {
            return None; // a number with no unit
        }
        let mult: i64 = match bytes[i].to_ascii_lowercase() {
            b'd' => 86_400,
            b'h' => 3_600,
            b'm' => 60,
            b's' => 1,
            _ => return None,
        };
        i += 1;
        total = total.checked_add(num.checked_mul(mult)?)?;
        found = true;
    }
    if found {
        Some(total)
    } else {
        None
    }
}

/// ISO-8601 duration `P[nD][T[nH][nM][nS]]` -> seconds, requiring at least one
/// field. Mirrors the TS regex; the H/M/S fields must appear in that order.
fn parse_iso_duration(raw: &str) -> Option<i64> {
    let rest = raw.strip_prefix(['P', 'p'])?;
    let bytes = rest.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    let mut total: i64 = 0;
    let mut any = false;

    // [ (\d+) D ]
    if i < n && bytes[i].is_ascii_digit() {
        let start = i;
        while i < n && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i >= n || !bytes[i].eq_ignore_ascii_case(&b'D') {
            return None;
        }
        let num: i64 = rest[start..i].parse().ok()?;
        total = total.checked_add(num.checked_mul(86_400)?)?;
        i += 1;
        any = true;
    }

    // [ T (\d+H)? (\d+M)? (\d+S)? ]
    if i < n {
        if !bytes[i].eq_ignore_ascii_case(&b'T') {
            return None;
        }
        i += 1;
        let mut last_rank = 0u8;
        while i < n {
            if !bytes[i].is_ascii_digit() {
                return None;
            }
            let start = i;
            while i < n && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i >= n {
                return None;
            }
            let (mult, rank): (i64, u8) = match bytes[i].to_ascii_uppercase() {
                b'H' => (3_600, 1),
                b'M' => (60, 2),
                b'S' => (1, 3),
                _ => return None,
            };
            if rank <= last_rank {
                return None; // H/M/S must appear in order, at most once each
            }
            last_rank = rank;
            let num: i64 = rest[start..i].parse().ok()?;
            total = total.checked_add(num.checked_mul(mult)?)?;
            i += 1;
            any = true;
        }
    }

    if any {
        Some(total)
    } else {
        None
    }
}

fn parse_date(word: &str, today: NaiveDate) -> Option<NaiveDate> {
    let w = word.to_lowercase();
    match w.as_str() {
        "today" => return Some(today),
        "tomorrow" | "tmr" | "tom" => return Some(today + Duration::days(1)),
        _ => {}
    }
    if let Some(wd) = parse_weekday(&w) {
        return Some(next_occurrence(today, wd));
    }
    if let Ok(d) = NaiveDate::parse_from_str(&w, "%Y-%m-%d") {
        return Some(d);
    }
    if let Ok(d) = NaiveDate::parse_from_str(&format!("{}/{}", today.format("%Y"), w), "%Y/%m/%d") {
        // A bare month/day is forward-looking (like the weekday parser above): if
        // it has already passed this year, roll to next year so e.g. "1/2" entered
        // on Dec 31 means next January rather than a date ten months in the past.
        if d < today {
            if let Some(next) = d.with_year(d.year() + 1) {
                return Some(next);
            }
        }
        return Some(d);
    }
    None
}

fn parse_weekday(w: &str) -> Option<Weekday> {
    match w {
        "mon" | "monday" => Some(Weekday::Mon),
        "tue" | "tues" | "tuesday" => Some(Weekday::Tue),
        "wed" | "weds" | "wednesday" => Some(Weekday::Wed),
        "thu" | "thur" | "thurs" | "thursday" => Some(Weekday::Thu),
        "fri" | "friday" => Some(Weekday::Fri),
        "sat" | "saturday" => Some(Weekday::Sat),
        "sun" | "sunday" => Some(Weekday::Sun),
        _ => None,
    }
}

fn next_occurrence(today: NaiveDate, wd: Weekday) -> NaiveDate {
    let delta =
        (7 + wd.number_from_monday() as i64 - today.weekday().number_from_monday() as i64) % 7;
    let delta = if delta == 0 { 7 } else { delta };
    today + Duration::days(delta)
}
