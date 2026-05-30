use chrono::{Datelike, Duration, NaiveDate, Weekday};
use serde::Serialize;

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct ParsedInput {
    pub title: String,
    pub tag_names: Vec<String>,
    pub due_date: Option<NaiveDate>,
    pub scheduled_date: Option<NaiveDate>,
}

/// Pure: takes the composer's raw string and "today" reference; returns structured tokens.
/// Unknown text becomes part of the title.
pub fn parse(input: &str, today: NaiveDate) -> ParsedInput {
    let mut out = ParsedInput::default();
    let mut title_parts: Vec<&str> = Vec::new();

    let tokens: Vec<&str> = input.split_whitespace().collect();
    let mut i = 0;
    while i < tokens.len() {
        let tok = tokens[i];
        if let Some(name) = tok.strip_prefix('#') {
            if !name.is_empty() {
                out.tag_names.push(name.to_string());
                i += 1;
                continue;
            }
        }
        if (tok == "due" || tok == "sched" || tok == "scheduled") && i + 1 < tokens.len() {
            if let Some(d) = parse_date(tokens[i + 1], today) {
                if tok == "due" { out.due_date = Some(d); }
                else            { out.scheduled_date = Some(d); }
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
