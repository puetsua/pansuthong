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
fn inbox_contains_only_untagged_tasks() {
    let doc = load("sample");
    let ids: Vec<&str> = doc.tasks_inbox().iter().map(|t| t.id.as_str()).collect();
    assert_eq!(ids, vec!["k_future1"]);
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
