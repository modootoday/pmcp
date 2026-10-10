use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct Item {
    title: String,
    quantity: u32,
    note: Option<String>,
}

fn main() {
    let input = r#"{"title":"first","quantity":2}"#;
    let item: Item = serde_json::from_str(input).expect("valid typed input");
    assert_eq!(item.title, "first");
    assert_eq!(item.quantity, 2);
    assert_eq!(item.note, None);
    let encoded = serde_json::to_string(&item).expect("serialize typed input");
    let decoded: Item = serde_json::from_str(&encoded).expect("validate serialized input");
    assert_eq!(decoded, item);
    assert!(serde_json::from_str::<Item>(r#"{"title":42,"quantity":2}"#).is_err());
    assert!(serde_json::from_str::<Item>(r#"{"title":"first","quantity":"2"}"#).is_err());
    assert!(
        serde_json::from_str::<Item>(r#"{"title":"first","quantity":2,"unknown":true}"#).is_err()
    );
    let exact: u64 = serde_json::from_str("18446744073709551615").expect("u64 precision");
    assert_eq!(exact, u64::MAX);
    assert_eq!(
        serde_json::to_string(&exact).expect("serialize u64"),
        "18446744073709551615"
    );
    let checks = [
        "typed deserialization and optional field",
        "typed JSON serialization round-trip",
        "numeric title string integer and unknown field rejection",
        "u64 integer precision",
    ];
    let evidence = serde_json::json!({ "productId": "serde-json", "ecosystem": "crates", "targetIdentity": "serde_json", "checks": checks, "examplesExecuted": checks.len() });
    println!("{}", evidence);
}
