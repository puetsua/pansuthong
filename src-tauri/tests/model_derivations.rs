use chrono::NaiveDate;
use pansutong_lib::model::Document;
use std::fs;

fn load(name: &str) -> Document {
    let path = format!("tests/fixtures/{name}.json");
    let s = fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {path}"));
    serde_json::from_str(&s).unwrap()
}

fn today() -> NaiveDate { NaiveDate::from_ymd_opt(2026, 5, 28).unwrap() }

#[test]
fn today_view_includes_overdue_scheduled_and_due() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_today(today()).iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["k_overdue1", "k_today1", "k_today2", "k_reno1"]);
}

#[test]
fn today_view_excludes_future_tasks() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_today(today()).iter().map(|t| t.id.as_str()).collect();
    assert!(!ids.contains(&"k_future1"));
}

#[test]
fn inbox_contains_tasks_with_no_pinned_tag() {
    // t_work and t_errand are pinned, so their tasks surface in the sidebar and
    // stay out of Inbox. k_reno1 (only the unpinned t_reno) and k_future1
    // (untagged) have no pinned tag, so they fall to Inbox.
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_inbox().iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["k_reno1", "k_future1"]);
}

#[test]
fn tag_lookup_returns_tasks_with_that_tag() {
    let doc = load("sample");
    let urgent: Vec<&str> = doc.tasks_for_tag("t_urgent").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(urgent, vec!["k_overdue1"]);
}

#[test]
fn empty_document_has_empty_derivations() {
    let doc = load("empty");
    assert!(doc.tasks_today(today()).is_empty());
    assert!(doc.tasks_inbox().is_empty());
}

#[test]
fn archived_tasks_drop_out_of_active_views() {
    // Inline doc (also exercises serde defaults for the new fields). One open
    // tagged task scheduled today, one archived counterpart, one archived inbox task.
    let doc: Document = serde_json::from_str(
        r##"{
            "version": 2,
            "tags": [{"id":"t_a","name":"a","color":"#000","priority":1,"pinned":true}],
            "tasks": [
                {"id":"k_open","title":"open","done":false,"scheduled_date":"2026-05-28","notes":"","tag_ids":["t_a"],"created_at":0},
                {"id":"k_arch","title":"arch","done":true,"scheduled_date":"2026-05-28","notes":"","tag_ids":["t_a"],"created_at":0,"archived":true},
                {"id":"k_arch_inbox","title":"ai","done":true,"notes":"","tag_ids":[],"created_at":0,"archived":true}
            ]
        }"##,
    )
    .unwrap();

    let today_ids: Vec<&str> = doc.tasks_today(today()).iter().map(|t| t.id.as_str()).collect();
    assert_eq!(today_ids, vec!["k_open"], "archived task excluded from Today");

    let tag_ids: Vec<&str> = doc.tasks_for_tag("t_a").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(tag_ids, vec!["k_open"], "archived task excluded from tag view");

    assert!(doc.tasks_inbox().is_empty(), "archived untagged task excluded from Inbox");
}
