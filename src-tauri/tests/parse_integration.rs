use chrono::NaiveDate;
use pansutong_lib::model::Priority;
use pansutong_lib::parse::{parse, ParsedInput};

fn today() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 5, 28).unwrap() } // Thu

#[test]
fn plain_title_passes_through() {
    let p = parse("Buy milk", today());
    assert_eq!(p.title, "Buy milk");
    assert!(p.tag_names.is_empty());
    assert_eq!(p.due_date, None);
    assert_eq!(p.scheduled_date, None);
    assert_eq!(p.priority, None);
}

#[test]
fn hash_tag_extracts() {
    let p = parse("Reply to Anna #work", today());
    assert_eq!(p.title, "Reply to Anna");
    assert_eq!(p.tag_names, vec!["work"]);
}

#[test]
fn multiple_tags_preserve_order() {
    let p = parse("Errand #home #urgent groceries", today());
    assert_eq!(p.title, "Errand groceries");
    assert_eq!(p.tag_names, vec!["home", "urgent"]);
}

#[test]
fn empty_hash_is_part_of_title() {
    let p = parse("Title # with hash", today());
    assert_eq!(p.title, "Title # with hash");
    assert!(p.tag_names.is_empty());
}

#[test]
fn bang_priority_low_med_high() {
    assert_eq!(parse("! task",   today()).priority, Some(Priority::Low));
    assert_eq!(parse("!! task",  today()).priority, Some(Priority::Med));
    assert_eq!(parse("!!! task", today()).priority, Some(Priority::High));
    assert_eq!(parse("!!!!! task", today()).priority, Some(Priority::High));
}

#[test]
fn bang_priority_strips_from_title() {
    assert_eq!(parse("!!task", today()).title, "task");
    assert_eq!(parse("!!! urgent thing", today()).title, "urgent thing");
}

#[test]
fn due_today() {
    let p = parse("Call dentist due today", today());
    assert_eq!(p.title, "Call dentist");
    assert_eq!(p.due_date, Some(today()));
}

#[test]
fn due_tomorrow() {
    let p = parse("Renew passport due tomorrow", today());
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap()));
}

#[test]
fn scheduled_keyword_alias() {
    let p1 = parse("Task sched today", today());
    let p2 = parse("Task scheduled today", today());
    assert_eq!(p1.scheduled_date, Some(today()));
    assert_eq!(p2.scheduled_date, Some(today()));
    assert_eq!(p1.title, "Task");
}

#[test]
fn due_weekday_next_occurrence() {
    let p = parse("Ship release due fri", today());
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap()));
    let p2 = parse("Standup due thu", today());
    assert_eq!(p2.due_date, Some(NaiveDate::from_ymd_opt(2026, 6, 4).unwrap()));
}

#[test]
fn due_mm_dd_assumes_current_year() {
    let p = parse("Birthday due 6/10", today());
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2026, 6, 10).unwrap()));
}

#[test]
fn due_iso_date() {
    let p = parse("Plan due 2027-01-15", today());
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2027, 1, 15).unwrap()));
}

#[test]
fn unrecognized_due_word_keeps_title() {
    let p = parse("Task due laterish", today());
    assert_eq!(p.title, "Task due laterish");
    assert_eq!(p.due_date, None);
}

#[test]
fn all_features_together() {
    let p = parse("!! Review PR #248 #work due fri", today());
    // Note: our grammar treats every #word as a tag. "#248" becomes tag "248".
    assert!(p.tag_names.contains(&"248".to_string()));
    assert!(p.tag_names.contains(&"work".to_string()));
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap()));
    assert_eq!(p.priority, Some(Priority::Med));
}

#[test]
fn empty_input_returns_default() {
    let p = parse("", today());
    assert_eq!(p, ParsedInput::default());
}

#[test]
fn only_whitespace_returns_default_with_empty_title() {
    let p = parse("   \t  ", today());
    assert_eq!(p.title, "");
}
