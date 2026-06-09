use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct ParsedInput {
    pub title: String,
    pub tag_names: Vec<String>,
    pub due_date: Option<NaiveDate>,
    pub start_date: Option<NaiveDate>,
}

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
        // "start" is the current keyword; "sched"/"scheduled" stay as aliases (#renamed).
        if (tok == "due" || tok == "start" || tok == "sched" || tok == "scheduled") && i + 1 < tokens.len() {
            if let Some(d) = parse_date(tokens[i + 1], today) {
                if tok == "due" { out.due_date = Some(d); }
                else            { out.start_date = Some(d); }
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
            while i < n && bytes[i] != b'"' { i += 1; }
            if i < n { i += 1; } // consume the closing quote when present
        } else {
            while i < n && !bytes[i].is_ascii_whitespace() { i += 1; }
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
    if name.is_empty() { None } else { Some(name.to_string()) }
}

fn parse_date(word: &str, today: NaiveDate) -> Option<NaiveDate> {
    let w = word.to_lowercase();
    match w.as_str() {
        "today"        => return Some(today),
        "tomorrow"|"tmr"|"tom" => return Some(today + Duration::days(1)),
        _ => {}
    }
    if let Some(wd) = parse_weekday(&w) {
        return Some(next_occurrence(today, wd));
    }
    if let Ok(d) = NaiveDate::parse_from_str(&w, "%Y-%m-%d") { return Some(d); }
    if let Ok(d) = NaiveDate::parse_from_str(&format!("{}/{}", today.format("%Y"), w), "%Y/%m/%d") {
        return Some(d);
    }
    None
}

fn parse_weekday(w: &str) -> Option<Weekday> {
    match w {
        "mon"|"monday"     => Some(Weekday::Mon),
        "tue"|"tues"|"tuesday" => Some(Weekday::Tue),
        "wed"|"weds"|"wednesday" => Some(Weekday::Wed),
        "thu"|"thur"|"thurs"|"thursday" => Some(Weekday::Thu),
        "fri"|"friday"     => Some(Weekday::Fri),
        "sat"|"saturday"   => Some(Weekday::Sat),
        "sun"|"sunday"     => Some(Weekday::Sun),
        _ => None,
    }
}

fn next_occurrence(today: NaiveDate, wd: Weekday) -> NaiveDate {
    let delta = (7 + wd.number_from_monday() as i64 - today.weekday().number_from_monday() as i64) % 7;
    let delta = if delta == 0 { 7 } else { delta };
    today + Duration::days(delta)
}
