use chrono::NaiveDate;
use pansutong_lib::parse::{parse, ParsedInput};

fn today() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 5, 28).unwrap()
} // Thu

#[test]
fn plain_title_passes_through() {
    let p = parse("Buy milk", today());
    assert_eq!(p.title, "Buy milk");
    assert!(p.tag_names.is_empty());
    assert_eq!(p.due_date, None);
    assert_eq!(p.start_date, None);
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
fn bangs_are_literal_title_text() {
    // The `!`/`!!`/`!!!` priority shortcut was removed; bangs are now plain text.
    assert_eq!(parse("!!task", today()).title, "!!task");
    assert_eq!(parse("!!! urgent thing", today()).title, "!!! urgent thing");
    assert_eq!(parse("! task", today()).title, "! task");
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
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap())
    );
}

#[test]
fn start_keyword_with_sched_scheduled_aliases() {
    let p0 = parse("Task start today", today());
    let p1 = parse("Task sched today", today());
    let p2 = parse("Task scheduled today", today());
    assert_eq!(p0.start_date, Some(today()));
    assert_eq!(p1.start_date, Some(today()));
    assert_eq!(p2.start_date, Some(today()));
    assert_eq!(p0.title, "Task");
}

#[test]
fn due_weekday_next_occurrence() {
    let p = parse("Ship release due fri", today());
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap())
    );
    let p2 = parse("Standup due thu", today());
    assert_eq!(
        p2.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 6, 4).unwrap())
    );
}

#[test]
fn due_mm_dd_assumes_current_year() {
    let p = parse("Birthday due 6/10", today());
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 6, 10).unwrap())
    );
}

#[test]
fn due_mm_dd_that_already_passed_rolls_to_next_year() {
    // Quick-entry dates are forward-looking (like the weekday parser). A bare
    // month/day that has already passed this year means next year — so "1/2"
    // entered on Dec 31 is next January, not the current (past) year.
    let dec31 = NaiveDate::from_ymd_opt(2026, 12, 31).unwrap();
    let p = parse("Pay rent due 1/2", dec31);
    assert_eq!(p.due_date, Some(NaiveDate::from_ymd_opt(2027, 1, 2).unwrap()));
}

#[test]
fn due_iso_date() {
    let p = parse("Plan due 2027-01-15", today());
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2027, 1, 15).unwrap())
    );
}

#[test]
fn unrecognized_due_word_keeps_title() {
    let p = parse("Task due laterish", today());
    assert_eq!(p.title, "Task due laterish");
    assert_eq!(p.due_date, None);
}

#[test]
fn all_features_together() {
    let p = parse("Review PR #248 #work due fri", today());
    // Note: our grammar treats every #word as a tag. "#248" becomes tag "248".
    assert!(p.tag_names.contains(&"248".to_string()));
    assert!(p.tag_names.contains(&"work".to_string()));
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap())
    );
    assert_eq!(p.title, "Review PR");
}

#[test]
fn quoted_tag_captures_spaces() {
    let p = parse("test3 #\"da fs\"", today());
    assert_eq!(p.title, "test3");
    assert_eq!(p.tag_names, vec!["da fs"]);
}

#[test]
fn quoted_tag_coexists_with_plain_tags_and_dates() {
    let p = parse("Plan #\"big project\" #work due fri", today());
    assert_eq!(p.title, "Plan");
    assert_eq!(p.tag_names, vec!["big project", "work"]);
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap())
    );
}

#[test]
fn unterminated_quoted_tag_consumes_to_end() {
    let p = parse("Buy milk #\"weekend chores", today());
    assert_eq!(p.title, "Buy milk");
    assert_eq!(p.tag_names, vec!["weekend chores"]);
}

#[test]
fn empty_quoted_tag_is_literal_title_text() {
    let p = parse("Title #\"\" done", today());
    assert!(p.tag_names.is_empty());
    assert_eq!(p.title, "Title #\"\" done");
}

#[test]
fn quoted_tag_trims_surrounding_whitespace() {
    let p = parse("x #\"  spaced  \"", today());
    assert_eq!(p.tag_names, vec!["spaced"]);
}

#[test]
fn tilde_duration_sets_estimate_and_drops_from_title() {
    let p = parse("Write report ~1h30m", today());
    assert_eq!(p.title, "Write report");
    assert_eq!(p.estimated_seconds, Some(5400));
}

#[test]
fn tilde_accepts_single_unit_durations() {
    assert_eq!(parse("Call ~45m", today()).estimated_seconds, Some(2700));
    assert_eq!(parse("Nap ~2h", today()).estimated_seconds, Some(7200));
}

#[test]
fn tilde_bare_number_means_minutes() {
    assert_eq!(parse("Task ~30", today()).estimated_seconds, Some(1800));
}

#[test]
fn tilde_estimate_coexists_with_tags_and_dates() {
    let p = parse("Write report ~1h30m #work due fri", today());
    assert_eq!(p.title, "Write report");
    assert_eq!(p.estimated_seconds, Some(5400));
    assert_eq!(p.tag_names, vec!["work"]);
    assert_eq!(
        p.due_date,
        Some(NaiveDate::from_ymd_opt(2026, 5, 29).unwrap())
    );
}

#[test]
fn last_tilde_estimate_wins() {
    assert_eq!(parse("Plan ~30m ~1h", today()).estimated_seconds, Some(3600));
}

#[test]
fn tilde_accepts_iso_8601_durations() {
    assert_eq!(parse("Sprint ~PT1H30M", today()).estimated_seconds, Some(5400));
}

#[test]
fn unparseable_tilde_token_stays_in_title() {
    let p = parse("Task ~abc", today());
    assert_eq!(p.estimated_seconds, None);
    assert_eq!(p.title, "Task ~abc");
}

#[test]
fn zero_or_out_of_range_tilde_estimate_stays_in_title() {
    let zero = parse("Task ~0m", today());
    assert_eq!(zero.estimated_seconds, None);
    assert_eq!(zero.title, "Task ~0m");
    let huge = parse("Task ~999999h", today());
    assert_eq!(huge.estimated_seconds, None);
    assert_eq!(huge.title, "Task ~999999h");
}

#[test]
fn bare_tilde_is_literal_title_text() {
    assert_eq!(parse("Buy ~ milk", today()).title, "Buy ~ milk");
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
