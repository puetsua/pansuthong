use pansutong_lib::{model::Document, search::search};
use std::fs;

fn load() -> Document {
    let s = fs::read_to_string("tests/fixtures/sample.json").unwrap();
    serde_json::from_str(&s).unwrap()
}

#[test]
fn empty_query_returns_nothing() {
    let doc = load();
    assert!(search(&doc, "").is_empty());
    assert!(search(&doc, "   ").is_empty());
}

#[test]
fn matches_title_case_insensitive() {
    let doc = load();
    let hits: Vec<&str> = search(&doc, "ANNA").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(hits, vec!["k_overdue1"]);
}

#[test]
fn matches_notes() {
    let doc = load();
    let hits: Vec<&str> = search(&doc, "switch").iter().map(|t| t.id.as_str()).collect();
    assert_eq!(hits, vec!["k_reno1"]);
}

#[test]
fn substring_match() {
    let doc = load();
    let hits = search(&doc, "PR");
    assert!(hits.iter().any(|t| t.id == "k_today2"));
}

#[test]
fn no_results_when_query_misses() {
    let doc = load();
    assert!(search(&doc, "zzzz_not_a_word").is_empty());
}
